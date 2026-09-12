/**
 * Feines del planificador. Nomes per a administradors de la instal·lacio.
 *
 * Cada boto engega la feina en segon pla i contesta de seguida amb un
 * `#toast` i els fragments fora de banda (`#en-curs`, `#historial-feines`,
 * …). El resultat queda a `job_runs`, visible a l'historial.
 *
 * El pany es a la base de dades: la mateixa feina de primer nivell no es pot
 * tornar a engegar mentre encara corre (des de la UI, el cron o el CLI).
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
      titol: "Passada diaria",
      descripcio: "Sincronitza, classifica i analitza, en aquest ordre.",
    },
  ];
  if (config.ollamaEnabled) {
    passes.push({
      id: "passada-nocturna",
      titol: "Passada nocturna",
      descripcio: "El model local proposa categories i es torna a classificar.",
    });
  }
  passes.push({
    id: "totes",
    titol: "Totes les feines",
    descripcio: "Passada diaria, nocturna (si hi ha model), avisos i manteniment.",
  });

  const individuals: JobEntry[] = [
    {
      id: "sync",
      titol: "Sincronitzacio",
      descripcio: "Importa els moviments de totes les connexions actives.",
    },
    {
      id: "classify",
      titol: "Classificacio",
      descripcio: "Aparella traspassos i classifica els moviments pendents.",
    },
  ];
  if (config.ollamaEnabled) {
    individuals.push({
      id: "llm",
      titol: "Model local",
      descripcio: "Proposa una categoria per als comerços nous.",
    });
  }
  individuals.push(
    {
      id: "analyze",
      titol: "Analisi",
      descripcio: "Recalcula recurrents, rebuts que falten i descoberts.",
    },
    {
      id: "notify",
      titol: "Avisos",
      descripcio: "Envia per correu tots els avisos pendents.",
    },
    {
      id: "notify-urgents",
      titol: "Avisos urgents",
      descripcio: "Envia nomes els avisos critics pendents.",
    },
    {
      id: "maintenance",
      titol: "Manteniment",
      descripcio: "Esborra sessions caducades, tanca importacions penjades i reassigna.",
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
  const [darreres, enCursRuns, enCursNoms, salut, history] = await Promise.all([
    lastRunPerJob([...names, ...JOBS]),
    readRunning(),
    runningJobNames(),
    summaryHealth(),
    readHistory(filtersToService(filters)),
  ]);
  return { passes, individuals, darreres, enCursRuns, enCursNoms, salut, history, filters };
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
      enCurs: data.enCursNoms,
      oob: true,
    }),
    HistoryList({ page: data.history, filters: data.filters, oob: true }),
  ];
}

// --- Pagina ----------------------------------------------------------------

jobsRoutes.get("/", async (c) => {
  const jo = currentUser(c);
  const meus = await myWorkspaces(jo.id);
  const filters = historyFiltersSchema.parse(c.req.query());
  const data = await pageData(filters);

  return page(
    c,
    Layout({
      titol: "Feines",
      user: jo,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
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
  // El compte d'intents ve a l'adreça: el sondeig te limit i el porta el
  // servidor, no el client. Vegeu `lib/sondeig.ts`.
  const attempt = attemptFromQuery(c.req.query(ATTEMPT_PARAM));
  // El target principal es `#en-curs` (sense oob); la resta va fora de banda.
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
        enCurs: data.enCursNoms,
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

// --- Mutacions -------------------------------------------------------------

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
