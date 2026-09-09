/**
 * Passades compostes del planificador.
 *
 * Viuen aparte del `scheduler.ts` perque aquell fitxer engega el cron en
 * importar-se: la UI i el CLI no el poden tocar. L'ordre importa: no te
 * sentit classificar abans d'haver importat, ni analitzar recurrents abans
 * d'haver classificat.
 */

import { config } from "../../lib/config.ts";
import { feinaAnalisi } from "./analyze.ts";
import { feinaClassificacio } from "./classify.ts";
import { feinaModelLocal } from "./llm.ts";
import { feinaManteniment } from "./maintenance.ts";
import { feinaAvisos } from "./notify.ts";
import { feinaSincronitzacio } from "./sync.ts";

/** Importar, classificar i analitzar, en aquest ordre. */
export async function passadaDiaria(): Promise<string> {
  const trossos: string[] = [];
  trossos.push(await feinaSincronitzacio());
  trossos.push(await feinaClassificacio());
  trossos.push(await feinaAnalisi());
  return trossos.join("\n");
}

/**
 * El model local mira els comerços nous i despres es torna a classificar,
 * ja sense model, per escampar el que hagi proposat.
 */
export async function passadaNocturna(): Promise<string> {
  const model = await feinaModelLocal();
  const classificacio = await feinaClassificacio();
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
  trossos.push(await passadaDiaria());
  if (ambModelLocal) {
    trossos.push(await passadaNocturna());
  }
  trossos.push(await feinaAvisos());
  trossos.push(await feinaManteniment());
  return trossos.join("\n");
}
