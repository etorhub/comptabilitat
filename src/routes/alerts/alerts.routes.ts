/**
 * Rutes dels avisos.
 *
 * Es el primer recurs d'espai que es migra i, per tant, el que estrena tres
 * coses: el middleware que comprova l'acces a l'espai, la separacio entre
 * pagina i fragment, i els intercanvis fora de banda.
 *
 * NOTA SOBRE PERMISOS. A l'aplicacio de Python, marcar un avis com a llegit i
 * descartar-lo els podia fer **qualsevol membre de l'espai, fins i tot un
 * `viewer`** (`backend/app/api/routes/alerts.py:39,47`), a diferencia de la
 * resta d'endpoints que canvien alguna cosa, que demanen `editor`. Sembla un
 * descuit mes que una decisio. Es conserva tal com era, perque endurir-ho es
 * un canvi de comportament que no toca fer de tapadillo; queda anotat aqui i
 * a `AGENTS.md` per decidir-ho a part.
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
import { countNewAlerts } from "../../services/comptadors.ts";
import { AlertsList, AlertCard } from "./alerts.fragment.ts";
import { AlertsPage } from "./alerts.page.ts";
import { alertFiltersSchema, alertFiltersToQuery } from "./alerts.schema.ts";

export const alertsRoutes = new Hono();

/** Els avisos de l'espai, els mes nous primer. */
async function readAlerts(ledgerId: number, descartats: boolean, limit: number) {
  const estats = descartats
    ? (["new", "read", "dismissed"] as const)
    : (["new", "read"] as const);

  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), inArray(alerts.status, [...estats])))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}

/**
 * Un avis d'aquest espai, o 404.
 *
 * Comprovar-ho aqui es el que impedeix descartar l'avis d'un altre espai
 * endevinant-ne l'identificador.
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

// --- Pagina ----------------------------------------------------------------

alertsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  return page(
    c,
    await workspacePage(c, "Avisos", AlertsPage({ codi: workspace.code, alertList, filters })),
  );
});

// --- Fragments -------------------------------------------------------------

alertsRoutes.get("/fragment/llista", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  // L'adreça que ha de quedar a la barra i a l'historial es la de la pagina.
  pushUrl(c, `/e/${workspace.code}/avisos${alertFiltersToQuery(filters)}`);

  return fragment(c, AlertsList({ codi: workspace.code, alertList, filters }));
});

// --- Mutacions -------------------------------------------------------------

alertsRoutes.post("/:id/llegit", async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest avis no existeix");

  const alert = await alertInWorkspace(id, workspace.id);

  // Nomes te sentit sobre un avis nou; si ja estava llegit, no toquem res.
  const actualitzat =
    alert.status === "new"
      ? ((
          await db.update(alerts).set({ status: "read" }).where(eq(alerts.id, id)).returning()
        )[0] ?? alert)
      : alert;

  return fragment(
    c,
    // El tros que ha canviat, el comptador de la barra lateral fora de banda,
    // i el `#toast` net per esborrar l'error que hi pogues haver.
    await withOob(
      AlertCard({
        codi: workspace.code,
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

  // La llista sencera i no nomes la targeta: descartar l'ultim avis pendent
  // ha de deixar veure que no en queda cap.
  const filters = alertFiltersSchema.parse(c.req.query());
  const alertList = await readAlerts(workspace.id, filters.descartats, filters.limit);

  return fragment(
    c,
    await withOob(
      AlertsList({ codi: workspace.code, alertList, filters: filters }),
      AlertCounter(await countNewAlerts(workspace.id), true),
      clearToast(),
    ),
  );
});
