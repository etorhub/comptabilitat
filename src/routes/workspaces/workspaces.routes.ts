/**
 * Configuracio de l'espai.
 *
 * Nomes els administradors **d'aquest espai** el poden configurar; qualsevol
 * membre en pot veure la pantalla.
 */

import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { ledgers, roleAtLeast, userLedgerPermissions, users } from "../../db/schema/index.ts";
import { fragment, page, toast, withOob } from "../../lib/http.ts";
import {
  currentRole,
  currentWorkspace,
  requireWorkspaceAdmin,
} from "../../middleware/workspace.ts";
import { FormEspai, type MembreVista } from "./workspaces.fragment.tsx";
import { WorkspacePage } from "./workspaces.page.tsx";
import { workspaceUpdateSchema } from "./workspaces.schema.ts";

export const workspacesRoutes = new Hono();

async function membres(ledgerId: number): Promise<MembreVista[]> {
  const files = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      role: userLedgerPermissions.role,
    })
    .from(userLedgerPermissions)
    .innerJoin(users, eq(users.id, userLedgerPermissions.userId))
    .where(eq(userLedgerPermissions.ledgerId, ledgerId))
    .orderBy(asc(users.email));
  return files;
}

workspacesRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);

  return page(
    c,
    await workspacePage(
      c,
      "Configuracio",
      WorkspacePage({
        espai,
        membres: await membres(espai.id),
        potConfigurar: roleAtLeast(currentRole(c), "admin"),
      }),
    ),
  );
});

workspacesRoutes.post("/", requireWorkspaceAdmin, async (c) => {
  const espai = currentWorkspace(c);
  const parsed = workspaceUpdateSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        FormEspai({ espai, errors: zodErrors(parsed.error) }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  const [actualitzat] = await db
    .update(ledgers)
    .set({
      name: parsed.data.name,
      description: parsed.data.description,
      color: parsed.data.color,
      overdraftThreshold: parsed.data.overdraft_threshold,
      alertRecipients: parsed.data.alert_recipients,
    })
    .where(eq(ledgers.id, espai.id))
    .returning();

  return fragment(
    c,
    await withOob(
      FormEspai({ espai: actualitzat ?? espai, fet: true }),
      toast("Configuracio desada", "success"),
    ),
  );
});
