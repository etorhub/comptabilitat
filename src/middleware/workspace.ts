/**
 * Sealed workspaces: resolves the workspace in the URL and checks your access.
 *
 * Two things here are product guarantees, not details:
 *
 *   1. **Whoever has no access to a workspace gets a 404, not a 403.** They
 *      should not even learn it exists. Both cases — it does not exist, and
 *      you have no access — must give exactly the same response.
 *   2. **Being an administrator of the installation grants no workspace
 *      access.** Whoever manages banks and users does not, by default, see
 *      anybody's books. Access is granted one workspace at a time.
 *
 * No data route may query `ledgers` on its own: they all hang off this
 * middleware.
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
 * The workspaces the user can reach, in the order they should be shown.
 * Used by the sidebar's picker.
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
 * Resolves `/e/:codi`. Leaves the workspace and the role on the context.
 *
 * One query, with an `inner join` over the permissions: no permission row
 * means no result, and the 404 falls out on its own without anywhere having to
 * decide between "does not exist" and "you have no access".
 */
export const workspaceMiddleware: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  const code = c.req.param("codi");

  if (code === undefined) {
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
    .where(and(eq(ledgers.code, code), eq(ledgers.isActive, true)))
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
 * Demands a minimum role inside the workspace.
 *
 * Here it *is* a 403 and not a 404: whoever gets this far already knows the
 * workspace exists, because they have access to it; what they lack is enough
 * permission.
 */
export function requireRole(minim: LedgerRole): MiddlewareHandler {
  return async (c, next) => {
    if (!roleAtLeast(c.get("role"), minim)) {
      throw new ForbiddenError(`Cal ser com a minim ${minim} en aquest espai`);
    }
    await next();
  };
}

/** Can categorise and annotate. */
export const requireEditor = requireRole("editor");
/** Can configure the workspace: accounts, alert recipients, users. */
export const requireWorkspaceAdmin = requireRole("admin");
