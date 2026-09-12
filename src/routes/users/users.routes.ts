/**
 * User routes. Installation administrators only.
 *
 * This is where workspace access is granted. It is worth remembering because
 * it is the guarantee everything else rests on: **being an installation
 * administrator grants access to no workspace**; it has to be given workspace
 * by workspace, and that is done from here.
 */

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.ts";
import { Layout } from "../../components/layout.ts";
import { db } from "../../db/client.ts";
import { ledgers, userLedgerPermissions, users } from "../../db/schema/index.ts";
import { destroyAllSessions, destroyOtherSessions, hashPassword } from "../../lib/auth.ts";
import {
  AppError,
  NotFoundError,
  fragment,
  idFromRoute,
  page,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { CreateForm, List, Card, type UserView } from "./users.fragment.ts";
import { UsersPage } from "./users.page.ts";
import {
  grantSchema,
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
} from "./users.schema.ts";

export const usersRoutes = new Hono();

/** All the users with the workspaces they can access. */
async function listUsers(): Promise<UserView[]> {
  const all = await db.select().from(users).orderBy(asc(users.email));

  const permissions = await db
    .select({
      userId: userLedgerPermissions.userId,
      ledgerId: userLedgerPermissions.ledgerId,
      role: userLedgerPermissions.role,
      code: ledgers.code,
      name: ledgers.name,
    })
    .from(userLedgerPermissions)
    .innerJoin(ledgers, eq(ledgers.id, userLedgerPermissions.ledgerId));

  return all.map((user) => ({
    ...user,
    access: permissions
      .filter((p) => p.userId === user.id)
      .map((p) => ({ ledgerId: p.ledgerId, code: p.code, name: p.name, role: p.role })),
  }));
}

async function userView(id: number): Promise<UserView> {
  const all = await listUsers();
  const foundOne = all.find((u) => u.id === id);
  if (!foundOne) throw new NotFoundError("Aquest usuari no existeix");
  return foundOne;
}

const activeWorkspaces = () =>
  db.select().from(ledgers).where(eq(ledgers.isActive, true)).orderBy(asc(ledgers.position));

// --- Page ------------------------------------------------------------------

usersRoutes.get("/", async (c) => {
  const me = currentUser(c);
  const [userList, workspaces, mine] = await Promise.all([
    listUsers(),
    activeWorkspaces(),
    myWorkspaces(me.id),
  ]);

  return page(
    c,
    Layout({
      title: "Usuaris",
      user: me,
      csrfToken: c.get("csrfToken") ?? "",
      path: c.req.path,
      workspaces: mine,
      children: UsersPage({ userList, workspaces, me: me.id }),
    }),
  );
});

// --- Mutations -------------------------------------------------------------

usersRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const parsed = userCreateSchema.safeParse(body);

  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        CreateForm({
          errors: zodErrors(parsed.error),
          values: { email: text("email"), full_name: text("full_name") },
        }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  const [ja] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  if (ja) {
    return fragment(
      c,
      await withOob(
        CreateForm({
          errors: { email: ["Ja hi ha un usuari amb aquest correu"] },
          values: { email: parsed.data.email, full_name: parsed.data.full_name },
        }),
        toast("Aquest correu ja esta donat d'alta"),
      ),
      409,
    );
  }

  await db.insert(users).values({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    passwordHash: await hashPassword(parsed.data.password),
    isAdmin: parsed.data.is_admin,
    isActive: true,
  });

  const me = currentUser(c);
  const [userList, workspaces] = await Promise.all([listUsers(), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      CreateForm({}),
      List({ userList, workspaces, me: me.id, oob: true }),
      toast(`Usuari ${parsed.data.email} creat`, "success"),
    ),
  );
});

/**
 * Saves the name and whether they are an installation administrator.
 *
 * You cannot remove admin from yourself: you would be left with nobody able
 * to manage users or banks.
 */
usersRoutes.post("/:id", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const me = currentUser(c);
  const body = await c.req.parseBody();
  const parsed = userUpdateSchema.safeParse(body);

  if (!parsed.success) {
    const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);
    return fragment(
      c,
      await withOob(
        Card({
          user: { ...view, fullName: String(body.full_name ?? view.fullName) },
          workspaces,
          me: me.id,
          editErrors: zodErrors(parsed.error),
        }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("Aquest usuari no existeix");

  if (id === me.id && !parsed.data.is_admin) {
    throw new AppError("No et pots treure a tu mateix l'admin", 422);
  }

  await db
    .update(users)
    .set({ fullName: parsed.data.full_name, isAdmin: parsed.data.is_admin })
    .where(eq(users.id, id));

  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, me: me.id }),
      toast("Usuari actualitzat", "success"),
    ),
  );
});

/**
 * Resets a user's password (the administrator sets it).
 *
 * It closes their sessions: otherwise they would stay signed in with the old
 * password until those expired. If you reset your own, the current session is
 * kept so as not to invalidate the CSRF already drawn on the page.
 */
usersRoutes.post("/:id/contrasenya", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const me = currentUser(c);
  const body = await c.req.parseBody();
  const parsed = passwordResetSchema.safeParse(body);

  if (!parsed.success) {
    const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);
    return fragment(
      c,
      await withOob(
        Card({
          user: view,
          workspaces,
          me: me.id,
          passwordErrors: zodErrors(parsed.error),
        }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("Aquest usuari no existeix");

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(users.id, id));

  if (id === me.id) {
    const tokenHash = c.get("sessionTokenHash");
    if (tokenHash !== null) await destroyOtherSessions(id, tokenHash);
  } else {
    await destroyAllSessions(id);
  }

  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, me: me.id }),
      toast("Contrasenya reiniciada i sessions tancades", "success"),
    ),
  );
});

/**
 * Grants or removes a user's access to a workspace.
 *
 * An empty `role` means removing it. Removing access deletes nothing: they
 * simply stop seeing the workspace.
 */
usersRoutes.post("/:id/acces", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const parsed = grantSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return toastOnly(c, "Peticio no valida", 422);

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("Aquest usuari no existeix");

  const [workspace] = await db
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(eq(ledgers.id, parsed.data.ledger_id))
    .limit(1);
  if (!workspace) throw new NotFoundError("Aquest espai no existeix");

  const on = and(
    eq(userLedgerPermissions.userId, id),
    eq(userLedgerPermissions.ledgerId, workspace.id),
  );

  if (parsed.data.role === "") {
    await db.delete(userLedgerPermissions).where(on);
  } else {
    const [ja] = await db
      .select({ id: userLedgerPermissions.id })
      .from(userLedgerPermissions)
      .where(on)
      .limit(1);

    if (ja) {
      await db
        .update(userLedgerPermissions)
        .set({ role: parsed.data.role })
        .where(eq(userLedgerPermissions.id, ja.id));
    } else {
      await db
        .insert(userLedgerPermissions)
        .values({ userId: id, ledgerId: workspace.id, role: parsed.data.role });
    }
  }

  const me = currentUser(c);
  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, me: me.id }),
      toast("Acces actualitzat", "success"),
    ),
  );
});

/**
 * Activates or deactivates a user.
 *
 * Deactivating them closes all their sessions: otherwise they would stay
 * signed in until those expired on their own, which can be two weeks.
 */
usersRoutes.post("/:id/estat", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const me = currentUser(c);

  if (id === me.id) {
    throw new AppError("No et pots desactivar tu mateix", 422);
  }

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("Aquest usuari no existeix");

  const active = !user.isActive;
  await db.update(users).set({ isActive: active }).where(eq(users.id, id));
  if (!active) await destroyAllSessions(id);

  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, me: me.id }),
      toast(active ? "Usuari activat" : "Usuari desactivat i sessions tancades", "success"),
    ),
  );
});
