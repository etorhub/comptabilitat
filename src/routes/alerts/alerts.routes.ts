/**
 * Alert routes.
 *
 * This is the first workspace resource to be migrated and therefore the one
 * that introduces three things: the middleware that checks workspace access,
 * the split between page and fragment, and out-of-band swaps.
 *
 * NOTE ON PERMISSIONS. In the Python application, marking an alert as read
 * and dismissing it could be done by **any member of the workspace, even a
 * `viewer`** (`backend/app/api/routes/alerts.py:39,47`), unlike the rest of
 * the endpoints that change something, which require `editor`. It looks like
 * an oversight rather than a decision. It is kept as it was, because
 * tightening it is a behavior change that should not be slipped in; it is
 * noted here and in `AGENTS.md` to be decided separately.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { AlertCounter } from "../../components/layout.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { alerts } from "../../db/schema/index.ts";
import {
  NotFoundError,
  clearToast,
  fragment,
  idFromRoute,
  page,
  pushUrl,
  withOob,
} from "../../lib/http.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { countNewAlerts } from "../../services/counters.ts";
import { AlertsList, AlertCard } from "./alerts.fragment.ts";
import { AlertsPage } from "./alerts.page.ts";
import { alertFiltersSchema, alertFiltersToQuery } from "./alerts.schema.ts";

export const alertsRoutes = new Hono();

/** The workspace's alerts, newest first. */
async function readAlerts(ledgerId: number, descartats: boolean, limit: number) {
  const statuses = descartats
    ? (["new", "read", "dismissed"] as const)
    : (["new", "read"] as const);

  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), inArray(alerts.status, [...statuses])))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}

/**
 * An alert of this workspace, or 404.
 *
 * Checking it here is what stops someone dismissing another workspace's
 * alert by guessing its id.
 */
async function alertInWorkspace(id: number, ledgerId: number) {
  const [alert] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.ledgerId, ledgerId)))
    .limit(1);
  if (!alert) throw new NotFoundError("Aquest avis no existeix");
  return alert;
}

// --- Page ------------------------------------------------------------------

alertsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  return page(
    c,
    await workspacePage(c, "Avisos", AlertsPage({ code: workspace.code, alertList, filters })),
  );
});

// --- Fragments -------------------------------------------------------------

alertsRoutes.get("/fragment/llista", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  // The URL that should stay in the address bar and the history is the page's.
  pushUrl(c, `/e/${workspace.code}/avisos${alertFiltersToQuery(filters)}`);

  return fragment(c, AlertsList({ code: workspace.code, alertList, filters }));
});

// --- Mutations -------------------------------------------------------------

alertsRoutes.post("/:id/llegit", async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest avis no existeix");

  const alert = await alertInWorkspace(id, workspace.id);

  // Only makes sense on a new alert; if it was already read, we touch nothing.
  const actualitzat =
    alert.status === "new"
      ? ((
          await db.update(alerts).set({ status: "read" }).where(eq(alerts.id, id)).returning()
        )[0] ?? alert)
      : alert;

  return fragment(
    c,
    // The piece that changed, the sidebar counter out of band, and a clean
    // `#toast` to wipe any error that might be there.
    await withOob(
      AlertCard({
        code: workspace.code,
        alert: actualitzat,
        filters: alertFiltersSchema.parse(c.req.query()),
      }),
      AlertCounter(await countNewAlerts(workspace.id), true),
      clearToast(),
    ),
  );
});

alertsRoutes.post("/:id/descarta", async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest avis no existeix");

  await alertInWorkspace(id, workspace.id);
  await db.update(alerts).set({ status: "dismissed" }).where(eq(alerts.id, id));

  // The whole list and not just the card: dismissing the last pending alert
  // has to show that none are left.
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  return fragment(
    c,
    await withOob(
      AlertsList({ code: workspace.code, alertList, filters: filters }),
      AlertCounter(await countNewAlerts(workspace.id), true),
      clearToast(),
    ),
  );
});
