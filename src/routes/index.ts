/**
 * Route registry.
 *
 * Two levels, as the Python API had:
 *
 *   - cross-cutting: sign-in, password, users, connections, workspaces;
 *   - per-workspace, under `/e/:codi`, all behind the middleware that checks
 *     access.
 *
 * Resources are added here as they are migrated. While one is missing, its
 * URL gives a 404, which is the right answer.
 */

import { Hono } from "hono";

import { alertsRoutes } from "./alerts/alerts.routes.ts";
import { callbackRoute, connectionsRoutes } from "./connections/connections.routes.ts";
import { analyticsRoutes } from "./analytics/analytics.routes.ts";
import { authRoutes } from "./auth/auth.routes.ts";
import { categoriesRoutes } from "./categories/categories.routes.ts";
import { reportsExportRoutes, transactionsExportRoutes } from "./exports/exports.routes.ts";
import { homeRoutes } from "./home/home.routes.ts";
import { jobsRoutes } from "./jobs/jobs.routes.ts";
import { recurringRoutes } from "./recurring/recurring.routes.ts";
import { tagsRoutes } from "./tags/tags.routes.ts";
import { transactionsRoutes } from "./transactions/transactions.routes.ts";
import { usersRoutes } from "./users/users.routes.ts";
import { workspacesRoutes } from "./workspaces/workspaces.routes.ts";
import { requireAdmin, requireUser } from "../middleware/session.ts";
import { workspaceMiddleware } from "../middleware/workspace.ts";

/** Hangs some routes behind the installation-administrator guard. */
function withAdmin(routes: Hono): Hono {
  const sub = new Hono();
  sub.use("*", requireAdmin);
  sub.route("/", routes);
  return sub;
}

export function registerRoutes(app: Hono): void {
  // --- Cross-cutting -------------------------------------------------------
  app.route("/", authRoutes);
  app.route("/", homeRoutes);

  // The return from the bank after strong authentication. **Unauthenticated
  // and exempt from CSRF**: whoever arrives here comes from the bank and
  // carries no token of ours. What protects it is the single-use `eb_auth_state`.
  app.route("/", callbackRoute);

  // --- Installation administration -----------------------------------------
  //
  // Managing banks and users grants access to no workspace: they are separate things.
  //
  // Mind the mount point: an `app.route("/", admin)` with a `use("*")` inside
  // **applies the guard to the whole application**, not just to its own
  // routes, and would lock non-administrators out of the program. The guard
  // hangs off the sub-program and is mounted already under `/usuaris`.
  const userList = new Hono();
  userList.use("*", requireUser);
  userList.use("*", requireAdmin);
  userList.route("/", usersRoutes);
  app.route("/usuaris", userList);

  const connections = new Hono();
  connections.use("*", requireUser);
  connections.use("*", requireAdmin);
  connections.route("/", connectionsRoutes);
  app.route("/connexions", connections);

  const jobs = new Hono();
  jobs.use("*", requireUser);
  jobs.use("*", requireAdmin);
  jobs.route("/", jobsRoutes);
  app.route("/feines", jobs);

  // --- Inside a workspace --------------------------------------------------
  //
  // Everything hanging off here goes first through `requireUser` and through
  // the middleware that resolves the workspace and checks access. No data
  // route queries the `ledgers` table on its own.
  const workspace = new Hono();
  workspace.use("*", requireUser);
  workspace.use("*", workspaceMiddleware);

  // Workspace configuration: installation administrators only.
  // The guard goes on each sub-program, not on the whole `espai`: a `use("*")`
  // here would close off Dashboard, Transactions and the rest.
  workspace.route("/avisos", withAdmin(alertsRoutes));
  workspace.route("/categories", withAdmin(categoriesRoutes));
  workspace.route("/etiquetes", withAdmin(tagsRoutes));
  workspace.route("/configuracio", withAdmin(workspacesRoutes));
  workspace.route("/moviments", transactionsRoutes);
  workspace.route("/recurrents", recurringRoutes);
  // Downloads hang off Transactions and Reports, which is where they come
  // from. Each program knows only its own routes: before, a single one was
  // mounted at both URLs and each download answered twice, once at its own
  // and once at a junk one (`/moviments/informe.xlsx`).
  workspace.route("/moviments", transactionsExportRoutes);
  workspace.route("/informes", reportsExportRoutes);

  // Analytics carries the workspace root, the reports and the forecast.
  workspace.route("/", analyticsRoutes);

  app.route("/e/:codi", workspace);
}
