/**
 * Dashboard, report and forecast routes.
 *
 * Everything is read-only: any member of the workspace can get in.
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
import { workspaceBalance, balanceSeries } from "../../services/balances.ts";
import { buildForecast } from "../../services/forecast.ts";
import {
  countPendingReview,
  countUnclassified,
  incomeAndExpenses,
  monthBounds,
  categoryBreakdown,
  merchantBreakdown,
  monthlySeries,
} from "../../services/reports.ts";
import {
  ReportsContent,
  ForecastContent,
  DashboardPage,
  ForecastPage,
  ReportsPage,
} from "./analytics.page.ts";
import {
  dashboardSchema,
  forecastSchema,
  reportFiltersSchema,
  reportFiltersToQuery,
} from "./analytics.schema.ts";

export const analyticsRoutes = new Hono();

/** Alerts that have not been dismissed yet. */
async function activeAlerts(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), inArray(alerts.status, ["new", "read"])));
  return row?.n ?? 0;
}

// --- Dashboard -------------------------------------------------------------

analyticsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const { days } = dashboardSchema.parse(c.req.query());

  const today = todayLocal();
  const [inici] = monthBounds(today);
  const monthlyFrom = addDays(today, -365);

  const [
    balance,
    mesActual,
    perRevisar,
    unclassified,
    alertCount,
    monthly,
    categories,
    balances,
  ] = await Promise.all([
    workspaceBalance(workspace.id),
    incomeAndExpenses([workspace.id], inici, today),
    countPendingReview([workspace.id]),
    countUnclassified([workspace.id]),
    activeAlerts(workspace.id),
    monthlySeries([workspace.id], monthlyFrom, today),
    categoryBreakdown([workspace.id], null, null, true, 9),
    balanceSeries([workspace.id], addDays(today, -days), today),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      workspace.name,
      DashboardPage({
        code: workspace.code,
        workspaceName: workspace.name,
        workspaceColor: workspace.color,
        balance: balance.total,
        balanceDate: balance.date,
        mesActual,
        perRevisar,
        unclassified,
        activeAlerts: alertCount,
        canSeeAlerts: currentUser(c).isAdmin,
        monthly,
        categories,
        balances,
      }),
    ),
  );
});

// --- Reports ---------------------------------------------------------------

async function reportData(ledgerId: number, query: Record<string, string>) {
  const filters = reportFiltersSchema.parse(query);
  const today = todayLocal();
  const des = filters.des ?? addDays(today, -filters.mesos * 31);
  const to = filters.to ?? today;

  const [totals, monthly, expensesPerCategory, incomeByCategory, merchantList] =
    await Promise.all([
      incomeAndExpenses([ledgerId], des, to),
      monthlySeries([ledgerId], des, to),
      categoryBreakdown([ledgerId], des, to, true),
      categoryBreakdown([ledgerId], des, to, false),
      merchantBreakdown([ledgerId], des, to, 10),
    ]);

  return { filters, totals, monthly, expensesPerCategory, incomeByCategory, merchantList };
}

analyticsRoutes.get("/informes", async (c) => {
  const workspace = currentWorkspace(c);
  const data = await reportData(workspace.id, c.req.query());

  return page(
    c,
    await workspacePage(c, "Informes", ReportsPage({ code: workspace.code, ...data })),
  );
});

analyticsRoutes.get("/informes/fragment/contingut", async (c) => {
  const workspace = currentWorkspace(c);
  const { filters, ...data } = await reportData(workspace.id, c.req.query());

  pushUrl(c, `/e/${workspace.code}/informes${reportFiltersToQuery(filters)}`);

  return fragment(c, ReportsContent(data));
});

// --- Forecast --------------------------------------------------------------

analyticsRoutes.get("/previsio", async (c) => {
  const workspace = currentWorkspace(c);
  const { horitzo } = forecastSchema.parse(c.req.query());
  const forecast = await buildForecast(workspace, horitzo);

  return page(
    c,
    await workspacePage(c, "Previsio", ForecastPage({ code: workspace.code, forecast })),
  );
});

analyticsRoutes.get("/previsio/fragment/grafic", async (c) => {
  const workspace = currentWorkspace(c);
  const { horitzo } = forecastSchema.parse(c.req.query());
  const forecast = await buildForecast(workspace, horitzo);

  pushUrl(c, `/e/${workspace.code}/previsio${horitzo === 90 ? "" : `?horitzo=${horitzo}`}`);

  return fragment(c, ForecastContent({ code: workspace.code, forecast }));
});
