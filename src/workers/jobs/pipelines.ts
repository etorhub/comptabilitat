/**
 * Passades compostes del planificador.
 *
 * Viuen aparte del `scheduler.ts` perque aquell fitxer engega el cron en
 * importar-se: la UI i el CLI no el poden tocar. L'ordre importa: no te
 * sentit classificar abans d'haver importat, ni analitzar recurrents abans
 * d'haver classificat.
 *
 * Cada pas passa per `executaPas` quan corre dins d'`executaFeina`, de
 * manera que l'historial mostra la passada i els fills.
 */

import { config } from "../../lib/config.ts";
import { executaPas } from "../../services/job-runs.ts";
import { feinaAnalisi } from "./analyze.ts";
import { feinaClassificacio } from "./classify.ts";
import { feinaModelLocal } from "./llm.ts";
import { feinaManteniment } from "./maintenance.ts";
import { feinaAvisos } from "./notify.ts";
import { feinaSincronitzacio } from "./sync.ts";

/** Importar, classificar i analitzar, en aquest ordre. */
export async function passadaDiaria(): Promise<string> {
  const trossos: string[] = [];
  trossos.push(await executaPas("sync", () => feinaSincronitzacio()));
  trossos.push(await executaPas("classify", feinaClassificacio));
  trossos.push(await executaPas("analyze", feinaAnalisi));
  return trossos.join("\n");
}

/**
 * El model local mira els comerços nous i despres es torna a classificar,
 * ja sense model, per escampar el que hagi proposat.
 */
export async function passadaNocturna(): Promise<string> {
  const model = await executaPas("llm", () => feinaModelLocal());
  const classificacio = await executaPas("classify", feinaClassificacio);
  return `${model}\n${classificacio}`;
}

/**
 * Tot el que el planificador acabaria fent al llarg del dia, en un sol
 * cop: diària, nocturna (si Ollama hi es), avisos i manteniment.
 *
 * Els avisos urgents no hi van: `feinaAvisos` ja cobreix els critics, i
 * tornar-los a enviar els duplicaria.
 */
export async function passadaTotes(
  ambModelLocal: boolean = config.ollamaEnabled,
): Promise<string> {
  const trossos: string[] = [];
  trossos.push(await executaPas("passada-diaria", passadaDiaria));
  if (ambModelLocal) {
    trossos.push(await executaPas("passada-nocturna", passadaNocturna));
  }
  trossos.push(await executaPas("notify", feinaAvisos));
  trossos.push(await executaPas("maintenance", feinaManteniment));
  return trossos.join("\n");
}
