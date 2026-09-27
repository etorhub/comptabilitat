/**
 * Routes of the summaries resource: the reports the local model writes.
 *
 * GET  /resums                      → page: today's brief and the monthly reports.
 * GET  /resums/:periode             → page: one monthly report (`2026-08`).
 * GET  /resums/fragment/informe     → one report, polled while it is being written.
 * POST /resums/regenera             → rewrites one (editors); returns it, pending.
 *
 * Any member reads them. Every lookup takes the workspace: another workspace's
 * report is a 404 like one that does not exist.
 */

import type { Context } from "hono";
import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { roleAtLeast, type AiReportKind } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import { AppError, ConflictError, fragment, NotFoundError, page } from "../../lib/http.ts";
import { attemptFromQuery, ATTEMPT_PARAM } from "../../lib/polling.ts";
import { todayLocal } from "../../lib/time.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  enqueueReport,
  isPending,
  latestDaily,
  markPending,
  monthlyList,
  periodFor,
  reportOf,
  type ReportView,
} from "../../services/ai-reports.ts";
import { Report, type ReportProps } from "./summaries.fragment.ts";
import { MonthlyReportPage, SummariesPage } from "./summaries.page.ts";
import { MONTH, reportRefSchema } from "./summaries.schema.ts";

export const summariesRoutes = new Hono();

function props(
  c: Context,
  kind: AiReportKind,
  period: string,
  report: ReportView | null,
  attempt = 0,
): ReportProps {
  return {
    code: currentWorkspace(c).code,
    kind,
    period,
    report,
    canEdit: roleAtLeast(currentRole(c), "editor"),
    enabled: config.ollamaEnabled,
    attempt,
  };
}

// --- Pages -----------------------------------------------------------------

summariesRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const today = todayLocal();
  const lastMonth = periodFor("monthly", today);

  const [todays, latest, previous, monthly] = await Promise.all([
    reportOf(workspace.id, "daily", today),
    latestDaily(workspace.id),
    reportOf(workspace.id, "monthly", lastMonth),
    monthlyList(workspace.id),
  ]);

  // Before this morning's brief exists, the last one written is still worth
  // reading; regenerating from there writes today's.
  const daily =
    todays?.text || todays?.status === "pending" ? todays : latest?.text ? latest : todays;

  return page(
    c,
    await workspacePage(
      c,
      "Resums",
      SummariesPage({
        code: workspace.code,
        daily: props(c, "daily", today, daily),
        lastMonth: previous?.text ? null : props(c, "monthly", lastMonth, previous),
        monthly,
      }),
    ),
  );
});

summariesRoutes.get("/fragment/informe", async (c) => {
  const workspace = currentWorkspace(c);
  const parsed = reportRefSchema.safeParse(c.req.query());
  if (!parsed.success) throw new NotFoundError("Aquest informe no existeix");
  const { kind, period } = parsed.data;

  const report = await reportOf(workspace.id, kind, period);
  return fragment(
    c,
    Report(props(c, kind, period, report, attemptFromQuery(c.req.query(ATTEMPT_PARAM)))),
  );
});

summariesRoutes.get("/:periode", async (c) => {
  const workspace = currentWorkspace(c);
  const period = c.req.param("periode");
  if (!MONTH.test(period)) throw new NotFoundError("Aquest informe no existeix");

  const report = await reportOf(workspace.id, "monthly", period);
  if (report === null) throw new NotFoundError("Aquest informe no existeix");

  return page(
    c,
    await workspacePage(
      c,
      "Informe mensual",
      MonthlyReportPage({ code: workspace.code, report: props(c, "monthly", period, report) }),
    ),
  );
});

// --- Mutations -------------------------------------------------------------

summariesRoutes.post("/regenera", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  if (!config.ollamaEnabled) {
    throw new ConflictError("El model local no està activat en aquesta instal·lació");
  }

  const parsed = reportRefSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) throw new AppError("Aquest informe no existeix", 422);
  const { kind, period } = parsed.data;

  // The brief is about today's balance: yesterday's cannot be rewritten with
  // today's figures. And a month that has not ended has no report yet.
  const today = todayLocal();
  if (kind === "daily" && period !== today) {
    throw new AppError("Només es pot redactar el resum d'avui", 422);
  }
  if (kind === "monthly" && period >= today.slice(0, 7)) {
    throw new AppError("Aquest mes encara no s'ha acabat", 422);
  }

  if (await isPending(workspace.id, kind, period)) {
    throw new ConflictError("Aquest informe ja s'està redactant");
  }

  await markPending(workspace.id, kind, period);
  void enqueueReport({ id: workspace.id, name: workspace.name }, kind, period);

  return fragment(
    c,
    Report(props(c, kind, period, await reportOf(workspace.id, kind, period))),
  );
});
