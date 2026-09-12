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
  title: string,
  children: unknown,
): Promise<Html> {
  const user = currentUser(c);
  const workspace = currentWorkspace(c);

  const [workspaces, { perRevisar, newAlerts }] = await Promise.all([
    myWorkspaces(user.id),
    counters(workspace.id),
  ]);

  return Layout({
    title,
    user,
    csrfToken: c.get("csrfToken") ?? "",
    path: c.req.path,
    workspaces,
    workspace,
    perRevisar,
    newAlerts,
    children,
  });
}
