/**
 * Rutes dels usuaris. Nomes per a administradors de la instal·lacio.
 *
 * Aqui es concedeix l'acces als espais. Val la pena recordar-ho perque es la
 * garantia que sosté tot: **ser administrador de la instal·lacio no dona
 * acces a cap espai**; s'ha de donar espai per espai, i es fa des d'aqui.
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

/** Tots els usuaris amb els espais on tenen acces. */
async function listUsers(): Promise<UserView[]> {
  const all = await db.select().from(users).orderBy(asc(users.email));

  const permisos = await db
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
    accessos: permisos
      .filter((p) => p.userId === user.id)
      .map((p) => ({ ledgerId: p.ledgerId, code: p.code, name: p.name, role: p.role })),
  }));
}

async function userView(id: number): Promise<UserView> {
  const all = await listUsers();
  const trobat = all.find((u) => u.id === id);
  if (!trobat) throw new NotFoundError("Aquest usuari no existeix");
  return trobat;
}

const activeWorkspaces = () =>
  db.select().from(ledgers).where(eq(ledgers.isActive, true)).orderBy(asc(ledgers.position));

// --- Pagina ----------------------------------------------------------------

usersRoutes.get("/", async (c) => {
  const jo = currentUser(c);
  const [userList, workspaces, meus] = await Promise.all([
    listUsers(),
    activeWorkspaces(),
    myWorkspaces(jo.id),
  ]);

  return page(
    c,
    Layout({
      titol: "Usuaris",
      user: jo,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      workspaces: meus,
      children: UsersPage({ userList, workspaces, jo: jo.id }),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

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
          valors: { email: text("email"), full_name: text("full_name") },
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
          valors: { email: parsed.data.email, full_name: parsed.data.full_name },
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

  const jo = currentUser(c);
  const [userList, workspaces] = await Promise.all([listUsers(), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      CreateForm({}),
      List({ userList, workspaces, jo: jo.id, oob: true }),
      toast(`Usuari ${parsed.data.email} creat`, "success"),
    ),
  );
});

/**
 * Desa el nom i si es administrador de la instal·lacio.
 *
 * No et pots treure a tu mateix l'admin: quedaries sense ningu que pugui
 * gestionar usuaris ni bancs.
 */
usersRoutes.post("/:id", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const jo = currentUser(c);
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
          jo: jo.id,
          editErrors: zodErrors(parsed.error),
        }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("Aquest usuari no existeix");

  if (id === jo.id && !parsed.data.is_admin) {
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
      Card({ user: view, workspaces, jo: jo.id }),
      toast("Usuari actualitzat", "success"),
    ),
  );
});

/**
 * Reinicia la contrasenya d'un usuari (la posa l'administrador).
 *
 * Li tanca les sessions: si no, continuaria dins amb la contrasenya vella fins
 * que caduquessin. Si et reinicies la teva, es conserva la sessio actual per
 * no invalidar el CSRF ja dibuixat a la pagina.
 */
usersRoutes.post("/:id/contrasenya", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const jo = currentUser(c);
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
          jo: jo.id,
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

  if (id === jo.id) {
    const tokenHash = c.get("sessionTokenHash");
    if (tokenHash !== null) await destroyOtherSessions(id, tokenHash);
  } else {
    await destroyAllSessions(id);
  }

  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, jo: jo.id }),
      toast("Contrasenya reiniciada i sessions tancades", "success"),
    ),
  );
});

/**
 * Dona o treu l'acces d'un usuari a un espai.
 *
 * `role` buit vol dir treure'l. Treure l'acces no esborra res: nomes deixa de
 * veure l'espai.
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

  const jo = currentUser(c);
  const [view, workspaces] = await Promise.all([userView(id), activeWorkspaces()]);

  return fragment(
    c,
    await withOob(
      Card({ user: view, workspaces, jo: jo.id }),
      toast("Acces actualitzat", "success"),
    ),
  );
});

/**
 * Activa o desactiva un usuari.
 *
 * Desactivar-lo li tanca totes les sessions: si no, continuaria dins fins que
 * caduquessin soles, que poden ser dues setmanes.
 */
usersRoutes.post("/:id/estat", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquest usuari no existeix");
  const jo = currentUser(c);

  if (id === jo.id) {
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
      Card({ user: view, workspaces, jo: jo.id }),
      toast(active ? "Usuari activat" : "Usuari desactivat i sessions tancades", "success"),
    ),
  );
});
