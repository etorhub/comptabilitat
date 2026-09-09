/**
 * Feines del planificador. Nomes per a administradors de la instal·lacio.
 *
 * Cada boto engega la feina en segon pla i contesta de seguida amb un
 * `#toast`: la sincronitzacio i el model local poden trigar mes del que
 * aguanta cap intermediari. El resultat va al registre del servidor, com
 * quan corre el cron.
 *
 * El pany es per proces: la mateixa feina no es pot tornar a engegar mentre
 * encara corre des d'aqui. No sincronitza amb el worker ni amb el CLI.
 */

import { Hono } from "hono";

import { Layout } from "../../components/layout.tsx";
import { config } from "../../lib/config.ts";
import { AppError, ConflictError, page, toastOnly } from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { feinaAnalisi } from "../../workers/jobs/analyze.ts";
import { feinaClassificacio } from "../../workers/jobs/classify.ts";
import { feinaModelLocal } from "../../workers/jobs/llm.ts";
import { feinaManteniment } from "../../workers/jobs/maintenance.ts";
import { feinaAvisos, feinaAvisosUrgents } from "../../workers/jobs/notify.ts";
import {
  passadaDiaria,
  passadaNocturna,
  passadaTotes,
} from "../../workers/jobs/pipelines.ts";
import { feinaSincronitzacio } from "../../workers/jobs/sync.ts";
import { type EntradaFeina } from "./jobs.fragment.tsx";
import { JobsPage } from "./jobs.page.tsx";
import { type FeinaId, feinaSchema } from "./jobs.schema.ts";

export const jobsRoutes = new Hono();

/** Feines engegades des d'aquesta pagina que encara no han acabat. */
const enCurs = new Set<FeinaId>();

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

/**
 * Executa la feina i registra el resum, sense deixar que un error se'n dugui
 * el servidor. Allibera el pany quan acaba.
 */
async function corre(nom: FeinaId, feina: () => Promise<string>): Promise<void> {
  const començat = Date.now();
  try {
    const resum = await feina();
    console.info(`[${nom}] fet en ${Math.round((Date.now() - començat) / 1000)}s\n${resum}`);
  } catch (error) {
    console.error(`[${nom}] ha fallat:`, error);
  } finally {
    enCurs.delete(nom);
  }
}

// --- Pagina ----------------------------------------------------------------

jobsRoutes.get("/", async (c) => {
  const jo = currentUser(c);
  const meus = await myWorkspaces(jo.id);
  const { passades, individuals } = catalog();

  return page(
    c,
    Layout({
      titol: "Feines",
      user: jo,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      espais: meus,
      children: JobsPage({ passades, individuals }),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

jobsRoutes.post("/", async (c) => {
  const parsed = feinaSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    return toastOnly(c, "Aquesta feina no existeix", 422);
  }

  const id = parsed.data.feina;
  if (FEINES_MODEL.has(id) && !config.ollamaEnabled) {
    throw new AppError("El model local no esta actiu", 422);
  }

  if (enCurs.has(id)) {
    throw new ConflictError("Aquesta feina ja esta corrent");
  }

  enCurs.add(id);
  void corre(id, resolFeina(id));

  return toastOnly(c, "La feina ha començat; el resultat surt al registre del servidor", 200, "success");
});
