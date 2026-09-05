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

import { ComptadorAvisos } from "../../components/layout.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { alerts } from "../../db/schema/index.ts";
import {
  NotFoundError,
  clearToast,
  fragment,
  idDeLaRuta,
  page,
  pushUrl,
  withOob,
} from "../../lib/http.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { comptaAvisosNous } from "../../services/comptadors.ts";
import { LlistaAvisos, TargetaAvis } from "./alerts.fragment.tsx";
import { AlertsPage } from "./alerts.page.tsx";
import { alertFiltersSchema, alertFiltersToQuery } from "./alerts.schema.ts";

export const alertsRoutes = new Hono();

/** Els avisos de l'espai, els mes nous primer. */
async function llegeixAvisos(ledgerId: number, descartats: boolean, limit: number) {
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
async function avisDeLespai(id: number, ledgerId: number) {
  const [avis] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.ledgerId, ledgerId)))
    .limit(1);
  if (!avis) throw new NotFoundError("Aquest avis no existeix");
  return avis;
}

// --- Pagina ----------------------------------------------------------------

alertsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const avisos = await llegeixAvisos(espai.id, filters.descartats, filters.limit);

  return page(
    c,
    await workspacePage(c, "Avisos", AlertsPage({ codi: espai.code, avisos, filters })),
  );
});

// --- Fragments -------------------------------------------------------------

alertsRoutes.get("/fragment/llista", async (c) => {
  const espai = currentWorkspace(c);
  const filters = alertFiltersSchema.parse(c.req.query());
  const avisos = await llegeixAvisos(espai.id, filters.descartats, filters.limit);

  // L'adreça que ha de quedar a la barra i a l'historial es la de la pagina.
  pushUrl(c, `/e/${espai.code}/avisos${alertFiltersToQuery(filters)}`);

  return fragment(c, LlistaAvisos({ codi: espai.code, avisos, filters }));
});

// --- Mutacions -------------------------------------------------------------

alertsRoutes.post("/:id/llegit", async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest avis no existeix");

  const avis = await avisDeLespai(id, espai.id);

  // Nomes te sentit sobre un avis nou; si ja estava llegit, no toquem res.
  const actualitzat =
    avis.status === "new"
      ? ((
          await db.update(alerts).set({ status: "read" }).where(eq(alerts.id, id)).returning()
        )[0] ?? avis)
      : avis;

  return fragment(
    c,
    // El tros que ha canviat, el comptador de la barra lateral fora de banda,
    // i el `#toast` net per esborrar l'error que hi pogues haver.
    await withOob(
      TargetaAvis({
        codi: espai.code,
        avis: actualitzat,
        filters: alertFiltersSchema.parse(c.req.query()),
      }),
      ComptadorAvisos(await comptaAvisosNous(espai.id), true),
      clearToast(),
    ),
  );
});

alertsRoutes.post("/:id/descarta", async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest avis no existeix");

  await avisDeLespai(id, espai.id);
  await db.update(alerts).set({ status: "dismissed" }).where(eq(alerts.id, id));

  // La llista sencera i no nomes la targeta: descartar l'ultim avis pendent
  // ha de deixar veure que no en queda cap.
  const filtres = alertFiltersSchema.parse(c.req.query());
  const avisos = await llegeixAvisos(espai.id, filtres.descartats, filtres.limit);

  return fragment(
    c,
    await withOob(
      LlistaAvisos({ codi: espai.code, avisos, filters: filtres }),
      ComptadorAvisos(await comptaAvisosNous(espai.id), true),
      clearToast(),
    ),
  );
});
