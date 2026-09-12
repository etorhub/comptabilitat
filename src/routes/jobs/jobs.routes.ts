/**
 * Scheduler jobs. Installation administrators only.
 *
 * Each button starts the job in the background and answers straight away with
 * a `#toast` and the out-of-band fragments (`#en-curs`, `#historial-feines`,
 * …). The result is left in `job_runs`, visible in the history.
 *
 * The lock is in the database: the same top-level job cannot be started again
 * while it is still running (from the UI, cron or the CLI).
 */

import { Hono } from "hono";

import { Layout } from "../../components/layout.ts";
import { config } from "../../lib/config.ts";
import {
  AppError,
  ConflictError,
  fragment,
  idFromRoute,
  NotFoundError,
  page,
  pushUrl,
  toast,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import {
  lastRunPerJob,
  startJob,
  jobRunning,
  readRunning,
  readRun,
  readChildren,
  readHistory,
  runningJobNames,
  summaryHealth,
  syncRunsForRun,
} from "../../services/job-runs.ts";
import { analysisJob } from "../../workers/jobs/analyze.ts";
import { classificationJob } from "../../workers/jobs/classify.ts";
import { localModelJob } from "../../workers/jobs/llm.ts";
import { maintenanceJob } from "../../workers/jobs/maintenance.ts";
import { alertsJob, urgentAlertsJob } from "../../workers/jobs/notify.ts";
import { dailyPass, nightlyPass, passAll } from "../../workers/jobs/pipelines.ts";
import { syncJob } from "../../workers/jobs/sync.ts";
import {
  ScheduleHealth,
  RunDetail,
  Running,
  scheduleEntries,
  type JobEntry,
  JobsList,
  HistoryList,
} from "./jobs.fragment.ts";
import { JobsPage } from "./jobs.page.ts";
import { attemptFromQuery, ATTEMPT_PARAM } from "../../lib/sondeig.ts";
import {
  type JobId,
  JOBS,
  jobSchema,
  filtersToService,
  historyFiltersSchema,
  historyFiltersToQuery,
} from "./jobs.schema.ts";

export const jobsRoutes = new Hono();

const JOBS_MODEL: ReadonlySet<JobId> = new Set(["passada-nocturna", "llm"]);

function catalog(): { passes: JobEntry[]; individuals: JobEntry[] } {
  const passes: JobEntry[] = [
    {
      id: "passada-diaria",
      title: "Passada diaria",
      description: "Sincronitza, classifica i analitza, en aquest ordre.",
    },
  ];
  if (config.ollamaEnabled) {
    passes.push({
      id: "passada-nocturna",
      title: "Passada nocturna",
      description: "El model local proposa categories i es torna a classificar.",
    });
  }
  passes.push({
    id: "totes",
    title: "Totes les feines",
    description: "Passada diaria, nocturna (si hi ha model), avisos i manteniment.",
  });

  const individuals: JobEntry[] = [
    {
      id: "sync",
      title: "Sincronitzacio",
      description: "Importa els moviments de totes les connexions actives.",
    },
    {
      id: "classify",
      title: "Classificacio",
      description: "Aparella traspassos i classifica els moviments pendents.",
    },
  ];
  if (config.ollamaEnabled) {
    individuals.push({
      id: "llm",
      title: "Model local",
      description: "Proposa una categoria per als comerços nous.",
    });
  }
  individuals.push(
    {
      id: "analyze",
      title: "Analisi",
      description: "Recalcula recurrents, rebuts que falten i descoberts.",
    },
    {
      id: "notify",
      title: "Avisos",
      description: "Envia per correu tots els avisos pendents.",
    },
    {
      id: "notify-urgents",
      title: "Avisos urgents",
      description: "Envia nomes els avisos critics pendents.",
    },
    {
      id: "maintenance",
      title: "Manteniment",
      description: "Esborra sessions caducades, tanca importacions penjades i reassigna.",
    },
  );

  return { passes, individuals };
}

function resolveJob(id: JobId): () => Promise<string> {
  switch (id) {
    case "passada-diaria":
      return dailyPass;
    case "passada-nocturna":
      return nightlyPass;
    case "sync":
      return () => syncJob();
    case "classify":
      return classificationJob;
    case "llm":
      return () => localModelJob();
    case "analyze":
      return analysisJob;
    case "notify":
      return alertsJob;
    case "notify-urgents":
      return urgentAlertsJob;
    case "maintenance":
      return maintenanceJob;
    case "totes":
      return () => passAll();
  }
}

async function pageData(filters = historyFiltersSchema.parse({})) {
  const { passes, individuals } = catalog();
  const names = [...new Set([...passes, ...individuals].map((f) => f.id))];
  const [darreres, enCursRuns, runningNames, salut, history] = await Promise.all([
    lastRunPerJob([...names, ...JOBS]),
    readRunning(),
    runningJobNames(),
    summaryHealth(),
    readHistory(filtersToService(filters)),
  ]);
  return { passes, individuals, darreres, enCursRuns, runningNames, salut, history, filters };
}

async function oobMonitor(filters = historyFiltersSchema.parse({})) {
  const data = await pageData(filters);
  return [
    ScheduleHealth({
      entrades: scheduleEntries(data.darreres),
      salut: data.salut,
      oob: true,
    }),
    Running({ runs: data.enCursRuns, oob: true }),
    JobsList({
      passes: data.passes,
      individuals: data.individuals,
      darreres: data.darreres,
      enCurs: data.runningNames,
      oob: true,
    }),
    HistoryList({ page: data.history, filters: data.filters, oob: true }),
  ];
}

// --- Page ------------------------------------------------------------------

jobsRoutes.get("/", async (c) => {
  const me = currentUser(c);
  const meus = await myWorkspaces(me.id);
  const filters = historyFiltersSchema.parse(c.req.query());
  const data = await pageData(filters);

  return page(
    c,
    Layout({
      title: "Feines",
      user: me,
      csrfToken: c.get("csrfToken") ?? "",
      path: c.req.path,
      workspaces: meus,
      children: JobsPage(data),
    }),
  );
});

// --- Fragments -------------------------------------------------------------

jobsRoutes.get("/fragment/historial", async (c) => {
  const filters = historyFiltersSchema.parse(c.req.query());
  const history = await readHistory(filtersToService(filters));
  pushUrl(c, `/feines${historyFiltersToQuery(filters)}`);
  return fragment(c, HistoryList({ page: history, filters }));
});

jobsRoutes.get("/fragment/en-curs", async (c) => {
  const data = await pageData(historyFiltersSchema.parse({}));
  // The attempt counter comes in the URL: the poll has a limit and the server
  // holds it, not the client. See `lib/sondeig.ts`.
  const attempt = attemptFromQuery(c.req.query(ATTEMPT_PARAM));
  // The main target is `#en-curs` (no oob); the rest goes out of band.
  return fragment(
    c,
    await withOob(
      Running({ runs: data.enCursRuns, attempt }),
      ScheduleHealth({
        entrades: scheduleEntries(data.darreres),
        salut: data.salut,
        oob: true,
      }),
      JobsList({
        passes: data.passes,
        individuals: data.individuals,
        darreres: data.darreres,
        enCurs: data.runningNames,
        oob: true,
      }),
      HistoryList({
        page: data.history,
        filters: data.filters,
        oob: true,
      }),
    ),
  );
});

jobsRoutes.get("/fragment/execucio/:id", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquesta execució no existeix");
  const run = await readRun(id);
  if (run === null) throw new NotFoundError("Aquesta execució no existeix");
  const [children, syncs] = await Promise.all([readChildren(id), syncRunsForRun(run)]);
  return fragment(c, RunDetail({ run, children, syncs }));
});

// --- Mutations -------------------------------------------------------------

jobsRoutes.post("/", async (c) => {
  const parsed = jobSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    c.header("HX-Reswap", "none");
    return fragment(c, toast("Aquesta feina no existeix"), 422);
  }

  const id = parsed.data.job;
  if (JOBS_MODEL.has(id) && !config.ollamaEnabled) {
    throw new AppError("El model local no esta actiu", 422);
  }

  if (await jobRunning(id)) {
    throw new ConflictError("Aquesta feina ja esta corrent");
  }

  await startJob(id, "manual", resolveJob(id));

  c.header("HX-Reswap", "none");
  return fragment(
    c,
    await withOob(toast("La feina ha començat", "success"), ...(await oobMonitor())),
  );
});
