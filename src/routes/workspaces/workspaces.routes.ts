/**
 * Configuracio de l'espai.
 *
 * Nomes els administradors de la instal·lacio hi arriben (guarda a
 * `routes/index.ts`). Dins, nomes els administradors **d'aquest espai** el
 * poden canviar; la resta d'admins de la instal·lacio amb acces el veuen.
 */

import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { ledgers, roleAtLeast, userLedgerPermissions, users } from "../../db/schema/index.ts";
import { fragment, page, toast, withOob } from "../../lib/http.ts";
import {
  currentRole,
  currentWorkspace,
  requireWorkspaceAdmin,
} from "../../middleware/workspace.ts";
import { WorkspaceForm, type MemberView } from "./workspaces.fragment.ts";
import { WorkspacePage } from "./workspaces.page.ts";
import { workspaceUpdateSchema } from "./workspaces.schema.ts";

export const workspacesRoutes = new Hono();

async function members(ledgerId: number): Promise<MemberView[]> {
  const rows = await db
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
  return rows;
}

workspacesRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);

  return page(
    c,
    await workspacePage(
      c,
      "Espai",
      WorkspacePage({
        workspace,
        members: await members(workspace.id),
        potConfigurar: roleAtLeast(currentRole(c), "admin"),
      }),
    ),
  );
});

workspacesRoutes.post("/", requireWorkspaceAdmin, async (c) => {
  const workspace = currentWorkspace(c);
  const parsed = workspaceUpdateSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        WorkspaceForm({ workspace, errors: zodErrors(parsed.error) }),
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
    .where(eq(ledgers.id, workspace.id))
    .returning();

  return fragment(
    c,
    await withOob(
      WorkspaceForm({ workspace: actualitzat ?? workspace, fet: true }),
      toast("Configuracio desada", "success"),
    ),
  );
});
