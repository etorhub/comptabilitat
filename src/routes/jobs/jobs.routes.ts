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

import { Layout } from "../../components/layout.tsx";
import { config } from "../../lib/config.ts";
import {
  AppError,
  ConflictError,
  fragment,
  idDeLaRuta,
  NotFoundError,
  page,
  pushUrl,
  toast,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import {
  darreresPerFeina,
  engegaFeina,
  feinaEnCurs,
  llegeixEnCurs,
  llegeixExecucio,
  llegeixFills,
  llegeixHistorial,
  nomsEnCurs,
  resumSalut,
  syncRunsDeLExecucio,
} from "../../services/job-runs.ts";
import { feinaAnalisi } from "../../workers/jobs/analyze.ts";
import { feinaClassificacio } from "../../workers/jobs/classify.ts";
import { feinaModelLocal } from "../../workers/jobs/llm.ts";
import { feinaManteniment } from "../../workers/jobs/maintenance.ts";
import { feinaAvisos, feinaAvisosUrgents } from "../../workers/jobs/notify.ts";
import { passadaDiaria, passadaNocturna, passadaTotes } from "../../workers/jobs/pipelines.ts";
import { feinaSincronitzacio } from "../../workers/jobs/sync.ts";
import {
  AgendaSalut,
  DetallExecucio,
  EnCurs,
  entradesAgenda,
  type EntradaFeina,
  LlistaFeines,
  LlistaHistorial,
} from "./jobs.fragment.tsx";
import { JobsPage } from "./jobs.page.tsx";
import {
  type FeinaId,
  FEINES,
  feinaSchema,
  filtresAServei,
  historialFiltersSchema,
  historialFiltersToQuery,
} from "./jobs.schema.ts";

export const jobsRoutes = new Hono();

const FEINES_MODEL: ReadonlySet<FeinaId> = new Set(["passada-nocturna", "llm"]);

function catalog(): { passades: EntradaFeina[]; individuals: EntradaFeina[] } {
  const passades: EntradaFeina[] = [
    {
      id: "passada-diaria",
      titol: "Passada diaria",
      descripcio: "Sincronitza, classifica i analitza, en aquest ordre.",
    },
  ];
  if (config.ollamaEnabled) {
    passades.push({
      id: "passada-nocturna",
      titol: "Passada nocturna",
      descripcio: "El model local proposa categories i es torna a classificar.",
    });
  }
  passades.push({
    id: "totes",
    titol: "Totes les feines",
    descripcio: "Passada diaria, nocturna (si hi ha model), avisos i manteniment.",
  });

  const individuals: EntradaFeina[] = [
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

  return { passades, individuals };
}

function resolFeina(id: FeinaId): () => Promise<string> {
  switch (id) {
    case "passada-diaria":
      return passadaDiaria;
    case "passada-nocturna":
      return passadaNocturna;
    case "sync":
      return () => feinaSincronitzacio();
    case "classify":
      return feinaClassificacio;
    case "llm":
      return () => feinaModelLocal();
    case "analyze":
      return feinaAnalisi;
    case "notify":
      return feinaAvisos;
    case "notify-urgents":
      return feinaAvisosUrgents;
    case "maintenance":
      return feinaManteniment;
    case "totes":
      return () => passadaTotes();
  }
}

async function dadesPagina(filters = historialFiltersSchema.parse({})) {
  const { passades, individuals } = catalog();
  const noms = [...new Set([...passades, ...individuals].map((f) => f.id))];
  const [darreres, enCursRuns, enCursNoms, salut, historial] = await Promise.all([
    darreresPerFeina([...noms, ...FEINES]),
    llegeixEnCurs(),
    nomsEnCurs(),
    resumSalut(),
    llegeixHistorial(filtresAServei(filters)),
  ]);
  return { passades, individuals, darreres, enCursRuns, enCursNoms, salut, historial, filters };
}

async function oobMonitor(filters = historialFiltersSchema.parse({})) {
  const dades = await dadesPagina(filters);
  return [
    AgendaSalut({
      entrades: entradesAgenda(dades.darreres),
      salut: dades.salut,
      oob: true,
    }),
    EnCurs({ runs: dades.enCursRuns, oob: true }),
    LlistaFeines({
      passades: dades.passades,
      individuals: dades.individuals,
      darreres: dades.darreres,
      enCurs: dades.enCursNoms,
      oob: true,
    }),
    LlistaHistorial({ pagina: dades.historial, filters: dades.filters, oob: true }),
  ];
}

// --- Pagina ----------------------------------------------------------------

jobsRoutes.get("/", async (c) => {
  const jo = currentUser(c);
  const meus = await myWorkspaces(jo.id);
  const filters = historialFiltersSchema.parse(c.req.query());
  const dades = await dadesPagina(filters);

  return page(
    c,
    Layout({
      titol: "Feines",
      user: jo,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      espais: meus,
      children: JobsPage(dades),
    }),
  );
});

// --- Fragments -------------------------------------------------------------

jobsRoutes.get("/fragment/historial", async (c) => {
  const filters = historialFiltersSchema.parse(c.req.query());
  const historial = await llegeixHistorial(filtresAServei(filters));
  pushUrl(c, `/feines${historialFiltersToQuery(filters)}`);
  return fragment(c, LlistaHistorial({ pagina: historial, filters }));
});

jobsRoutes.get("/fragment/en-curs", async (c) => {
  const dades = await dadesPagina(historialFiltersSchema.parse({}));
  // El target principal es `#en-curs` (sense oob); la resta va fora de banda.
  return fragment(
    c,
    await withOob(
      EnCurs({ runs: dades.enCursRuns }),
      AgendaSalut({
        entrades: entradesAgenda(dades.darreres),
        salut: dades.salut,
        oob: true,
      }),
      LlistaFeines({
        passades: dades.passades,
        individuals: dades.individuals,
        darreres: dades.darreres,
        enCurs: dades.enCursNoms,
        oob: true,
      }),
      LlistaHistorial({
        pagina: dades.historial,
        filters: dades.filters,
        oob: true,
      }),
    ),
  );
});

jobsRoutes.get("/fragment/execucio/:id", async (c) => {
  const id = idDeLaRuta(c.req.param("id"), "Aquesta execució no existeix");
  const run = await llegeixExecucio(id);
  if (run === null) throw new NotFoundError("Aquesta execució no existeix");
  const [fills, syncs] = await Promise.all([llegeixFills(id), syncRunsDeLExecucio(run)]);
  return fragment(c, DetallExecucio({ run, fills, syncs }));
});

// --- Mutacions -------------------------------------------------------------

jobsRoutes.post("/", async (c) => {
  const parsed = feinaSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    c.header("HX-Reswap", "none");
    return fragment(c, toast("Aquesta feina no existeix"), 422);
  }

  const id = parsed.data.feina;
  if (FEINES_MODEL.has(id) && !config.ollamaEnabled) {
    throw new AppError("El model local no esta actiu", 422);
  }

  if (await feinaEnCurs(id)) {
    throw new ConflictError("Aquesta feina ja esta corrent");
  }

  await engegaFeina(id, "manual", resolFeina(id));

  c.header("HX-Reswap", "none");
  return fragment(
    c,
    await withOob(toast("La feina ha començat", "success"), ...(await oobMonitor())),
  );
});
