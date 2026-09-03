/**
 * Espais estancs: resol l'espai de l'adreça i comprova que hi tinguis acces.
 *
 * Dues coses d'aqui son garanties del producte, no detalls:
 *
 *   1. **Qui no te acces a un espai rep un 404, no un 403.** No ha de saber
 *      ni que existeix. Els dos casos —no existeix i no hi tens acces— han de
 *      donar exactament la mateixa resposta.
 *   2. **Ser administrador de la instal·lacio no dona acces a cap espai.**
 *      Qui gestiona els bancs i els usuaris no veu, per defecte, la
 *      comptabilitat de ningu. L'acces es concedeix espai per espai.
 *
 * Cap ruta de dades no ha de consultar `ledgers` pel seu compte: totes pengen
 * d'aquest middleware.
 */

import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import { db } from "../db/client.ts";
import {
  ledgers,
  roleAtLeast,
  userLedgerPermissions,
  type Ledger,
  type LedgerRole,
} from "../db/schema/index.ts";
import { ForbiddenError } from "../lib/http.ts";
import { currentUser } from "./session.ts";

declare module "hono" {
  interface ContextVariableMap {
    workspace: Ledger;
    role: LedgerRole;
  }
}

/**
 * Espais on l'usuari te acces, en l'ordre en que s'han de mostrar.
 * Serveix per al selector de la barra lateral.
 */
export async function myWorkspaces(userId: number): Promise<(Ledger & { role: LedgerRole })[]> {
  const rows = await db
    .select({ ledger: ledgers, role: userLedgerPermissions.role })
    .from(ledgers)
    .innerJoin(userLedgerPermissions, eq(userLedgerPermissions.ledgerId, ledgers.id))
    .where(and(eq(userLedgerPermissions.userId, userId), eq(ledgers.isActive, true)))
    .orderBy(ledgers.position, ledgers.name);

  return rows.map((r) => ({ ...r.ledger, role: r.role }));
}

/**
 * Resol `/e/:codi`. Deixa l'espai i el rol al context.
 *
 * Fa una sola consulta amb `inner join` sobre els permisos: si no hi ha fila
 * de permis, no hi ha resultat, i el 404 surt sol sense haver de decidir
 * enlloc si es «no existeix» o «no hi tens acces».
 */
export const workspaceMiddleware: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  const codi = c.req.param("codi");

  if (codi === undefined) {
    return c.notFound();
  }

  const rows = await db
    .select({ ledger: ledgers, role: userLedgerPermissions.role })
    .from(ledgers)
    .innerJoin(
      userLedgerPermissions,
      and(
        eq(userLedgerPermissions.ledgerId, ledgers.id),
        eq(userLedgerPermissions.userId, user.id),
      ),
    )
    .where(and(eq(ledgers.code, codi), eq(ledgers.isActive, true)))
    .limit(1);

  const found = rows[0];
  if (!found) {
    return c.notFound();
  }

  c.set("workspace", found.ledger);
  c.set("role", found.role);
  await next();
};

export function currentWorkspace(c: Context): Ledger {
  return c.get("workspace");
}

export function currentRole(c: Context): LedgerRole {
  return c.get("role");
}

/**
 * Exigeix un rol minim dins de l'espai.
 *
 * Aqui si que es un 403 i no un 404: qui arriba fins aqui ja sap que l'espai
 * existeix, perque hi te acces; el que no te es prou permis.
 */
export function requireRole(minim: LedgerRole): MiddlewareHandler {
  return async (c, next) => {
    if (!roleAtLeast(c.get("role"), minim)) {
      throw new ForbiddenError(`Cal ser com a minim ${minim} en aquest espai`);
    }
    await next();
  };
}

/** Pot classificar, anotar i crear regles. */
export const requireEditor = requireRole("editor");
/** Pot configurar l'espai: comptes, destinataris d'avisos, usuaris. */
export const requireWorkspaceAdmin = requireRole("admin");
