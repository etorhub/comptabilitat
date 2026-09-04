/**
 * Rutes dels usuaris. Nomes per a administradors de la instal·lacio.
 *
 * Aqui es concedeix l'acces als espais. Val la pena recordar-ho perque es la
 * garantia que sosté tot: **ser administrador de la instal·lacio no dona
 * acces a cap espai**; s'ha de donar espai per espai, i es fa des d'aqui.
 */

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.tsx";
import { Layout } from "../../components/layout.tsx";
import { db } from "../../db/client.ts";
import { ledgers, userLedgerPermissions, users } from "../../db/schema/index.ts";
import { destroyAllSessions, hashPassword } from "../../lib/auth.ts";
import {
  AppError,
  NotFoundError,
  fragment,
  idDeLaRuta,
  page,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { FormAlta, Llista, Targeta, type UsuariVista } from "./users.fragment.tsx";
import { UsersPage } from "./users.page.tsx";
import { grantSchema, userCreateSchema } from "./users.schema.ts";

export const usersRoutes = new Hono();

/** Tots els usuaris amb els espais on tenen acces. */
async function llistaUsuaris(): Promise<UsuariVista[]> {
  const tots = await db.select().from(users).orderBy(asc(users.email));

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

  return tots.map((usuari) => ({
    ...usuari,
    accessos: permisos
      .filter((p) => p.userId === usuari.id)
      .map((p) => ({ ledgerId: p.ledgerId, code: p.code, name: p.name, role: p.role })),
  }));
}

async function vistaUsuari(id: number): Promise<UsuariVista> {
  const tots = await llistaUsuaris();
  const trobat = tots.find((u) => u.id === id);
  if (!trobat) throw new NotFoundError("Aquest usuari no existeix");
  return trobat;
}

const espaisActius = () =>
  db.select().from(ledgers).where(eq(ledgers.isActive, true)).orderBy(asc(ledgers.position));

// --- Pagina ----------------------------------------------------------------

usersRoutes.get("/", async (c) => {
  const jo = currentUser(c);
  const [usuaris, espais, meus] = await Promise.all([
    llistaUsuaris(),
    espaisActius(),
    myWorkspaces(jo.id),
  ]);

  return page(
    c,
    Layout({
      titol: "Usuaris",
      user: jo,
      csrfToken: c.get("csrfToken") ?? "",
      espais: meus,
      children: UsersPage({ usuaris, espais, jo: jo.id }),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

usersRoutes.post("/", async (c) => {
  const cos = await c.req.parseBody();
  const parsed = userCreateSchema.safeParse(cos);

  const text = (clau: string) => (typeof cos[clau] === "string" ? (cos[clau] as string) : "");

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        FormAlta({
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
        FormAlta({
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
  const [usuaris, espais] = await Promise.all([llistaUsuaris(), espaisActius()]);

  return fragment(
    c,
    await withOob(
      FormAlta({}),
      Llista({ usuaris, espais, jo: jo.id, oob: true }),
      toast(`Usuari ${parsed.data.email} creat`, "success"),
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
  const id = idDeLaRuta(c.req.param("id"), "Aquest usuari no existeix");
  const parsed = grantSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return toastOnly(c, "Peticio no valida", 422);

  const [usuari] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!usuari) throw new NotFoundError("Aquest usuari no existeix");

  const [espai] = await db
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(eq(ledgers.id, parsed.data.ledger_id))
    .limit(1);
  if (!espai) throw new NotFoundError("Aquest espai no existeix");

  const on = and(
    eq(userLedgerPermissions.userId, id),
    eq(userLedgerPermissions.ledgerId, espai.id),
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
        .values({ userId: id, ledgerId: espai.id, role: parsed.data.role });
    }
  }

  const jo = currentUser(c);
  const [vista, espais] = await Promise.all([vistaUsuari(id), espaisActius()]);

  return fragment(
    c,
    await withOob(
      Targeta({ usuari: vista, espais, jo: jo.id }),
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
  const id = idDeLaRuta(c.req.param("id"), "Aquest usuari no existeix");
  const jo = currentUser(c);

  if (id === jo.id) {
    throw new AppError("No et pots desactivar tu mateix", 422);
  }

  const [usuari] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!usuari) throw new NotFoundError("Aquest usuari no existeix");

  const actiu = !usuari.isActive;
  await db.update(users).set({ isActive: actiu }).where(eq(users.id, id));
  if (!actiu) await destroyAllSessions(id);

  const [vista, espais] = await Promise.all([vistaUsuari(id), espaisActius()]);

  return fragment(
    c,
    await withOob(
      Targeta({ usuari: vista, espais, jo: jo.id }),
      toast(actiu ? "Usuari activat" : "Usuari desactivat i sessions tancades", "success"),
    ),
  );
});
