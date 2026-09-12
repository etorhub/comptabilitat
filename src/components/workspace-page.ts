/**
 * Builds a page from inside a workspace.
 *
 * Every workspace page goes through here, so the sidebar, the workspace picker
 * and the two counters always come out the same without anyone having to
 * remember.
 */

import type { Context } from "hono";

import { Layout } from "./layout.ts";
import type { Html } from "../lib/html.ts";
import { counters } from "../services/comptadors.ts";
import { currentUser } from "../middleware/session.ts";
import { currentWorkspace, myWorkspaces } from "../middleware/workspace.ts";

export async function workspacePage(
  c: Context,
  titol: string,
  children: unknown,
): Promise<Html> {
  const user = currentUser(c);
  const workspace = currentWorkspace(c);

  const [workspaces, { perRevisar, avisosNous }] = await Promise.all([
    myWorkspaces(user.id),
    counters(workspace.id),
  ]);

  return Layout({
    titol,
    user,
    csrfToken: c.get("csrfToken") ?? "",
    ruta: c.req.path,
    workspaces,
    workspace,
    perRevisar,
    avisosNous,
    children,
  });
}
