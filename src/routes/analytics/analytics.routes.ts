/**
 * Rutes del panell, els informes i la previsio.
 *
 * Tot es de nomes llegir: qualsevol membre de l'espai hi pot entrar.
 */

import { and, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { alerts } from "../../db/schema/index.ts";
import { fragment, page, pushUrl } from "../../lib/http.ts";
import { addDays, todayLocal } from "../../lib/time.ts";
import { currentUser } from "../../middleware/session.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { saldoEspai, serieSaldos } from "../../services/balances.ts";
import { construeixPrevisio } from "../../services/forecast.ts";
import {
  comptaPendentsRevisio,
  comptaSenseClassificar,
  ingressosIDespeses,
  limitsDelMes,
  repartimentCategories,
  repartimentComercos,
  serieMensual,
} from "../../services/reports.ts";
import {
  ContingutInformes,
  ContingutPrevisio,
  DashboardPage,
  ForecastPage,
  ReportsPage,
} from "./analytics.page.tsx";
import {
  dashboardSchema,
  forecastSchema,
  reportFiltersSchema,
  reportFiltersToQuery,
} from "./analytics.schema.ts";

export const analyticsRoutes = new Hono();

/** Avisos que encara no s'han descartat. */
async function avisosActius(ledgerId: number): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), inArray(alerts.status, ["new", "read"])));
  return fila?.n ?? 0;
}

// --- Panell ----------------------------------------------------------------

analyticsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const { dies } = dashboardSchema.parse(c.req.query());

  const avui = todayLocal();
  const [inici] = limitsDelMes(avui);
  const desDeMensual = addDays(avui, -365);

  const [saldo, mesActual, perRevisar, senseClassificar, nAvisos, mensual, categories, saldos] =
    await Promise.all([
      saldoEspai(espai.id),
      ingressosIDespeses([espai.id], inici, avui),
      comptaPendentsRevisio([espai.id]),
      comptaSenseClassificar([espai.id]),
      avisosActius(espai.id),
      serieMensual([espai.id], desDeMensual, avui),
      repartimentCategories([espai.id], null, null, true, 9),
      serieSaldos([espai.id], addDays(avui, -dies), avui),
    ]);

  return page(
    c,
    await workspacePage(
      c,
      espai.name,
      DashboardPage({
        codi: espai.code,
        nomEspai: espai.name,
        colorEspai: espai.color,
        saldo: saldo.total,
        dataSaldo: saldo.data,
        mesActual,
        perRevisar,
        senseClassificar,
        avisosActius: nAvisos,
        potVeureAvisos: currentUser(c).isAdmin,
        mensual,
        categories,
        saldos,
      }),
    ),
  );
});

// --- Informes --------------------------------------------------------------

async function dadesInformes(ledgerId: number, query: Record<string, string>) {
  const filters = reportFiltersSchema.parse(query);
  const avui = todayLocal();
  const des = filters.des ?? addDays(avui, -filters.mesos * 31);
  const fins = filters.fins ?? avui;

  const [totals, mensual, despesesPerCategoria, ingressosPerCategoria, comercos] =
    await Promise.all([
      ingressosIDespeses([ledgerId], des, fins),
      serieMensual([ledgerId], des, fins),
      repartimentCategories([ledgerId], des, fins, true),
      repartimentCategories([ledgerId], des, fins, false),
      repartimentComercos([ledgerId], des, fins, 10),
    ]);

  return { filters, totals, mensual, despesesPerCategoria, ingressosPerCategoria, comercos };
}

analyticsRoutes.get("/informes", async (c) => {
  const espai = currentWorkspace(c);
  const dades = await dadesInformes(espai.id, c.req.query());

  return page(
    c,
    await workspacePage(c, "Informes", ReportsPage({ codi: espai.code, ...dades })),
  );
});

analyticsRoutes.get("/informes/fragment/contingut", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, ...dades } = await dadesInformes(espai.id, c.req.query());

  pushUrl(c, `/e/${espai.code}/informes${reportFiltersToQuery(filters)}`);

  return fragment(c, ContingutInformes(dades));
});

// --- Previsio --------------------------------------------------------------

analyticsRoutes.get("/previsio", async (c) => {
  const espai = currentWorkspace(c);
  const { horitzo } = forecastSchema.parse(c.req.query());
  const previsio = await construeixPrevisio(espai, horitzo);

  return page(
    c,
    await workspacePage(c, "Previsio", ForecastPage({ codi: espai.code, previsio })),
  );
});

analyticsRoutes.get("/previsio/fragment/grafic", async (c) => {
  const espai = currentWorkspace(c);
  const { horitzo } = forecastSchema.parse(c.req.query());
  const previsio = await construeixPrevisio(espai, horitzo);

  pushUrl(c, `/e/${espai.code}/previsio${horitzo === 90 ? "" : `?horitzo=${horitzo}`}`);

  return fragment(c, ContingutPrevisio({ codi: espai.code, previsio }));
});
