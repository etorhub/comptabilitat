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
import { runStep } from "../../services/job-runs.ts";
import { analysisJob } from "./analyze.ts";
import { classificationJob } from "./classify.ts";
import { localModelJob } from "./llm.ts";
import { maintenanceJob } from "./maintenance.ts";
import { alertsJob } from "./notify.ts";
import { syncJob } from "./sync.ts";

/** Importar, classificar i analitzar, en aquest ordre. */
export async function dailyPass(): Promise<string> {
  const parts: string[] = [];
  parts.push(await runStep("sync", () => syncJob()));
  parts.push(await runStep("classify", classificationJob));
  parts.push(await runStep("analyze", analysisJob));
  return parts.join("\n");
}

/**
 * El model local mira els comerços nous i despres es torna a classificar,
 * ja sense model, per escampar el que hagi proposat.
 */
export async function nightlyPass(): Promise<string> {
  const model = await runStep("llm", () => localModelJob());
  const classification = await runStep("classify", classificationJob);
  return `${model}\n${classification}`;
}

/**
 * Tot el que el planificador acabaria fent al llarg del dia, en un sol
 * cop: diària, nocturna (si Ollama hi es), avisos i manteniment.
 *
 * Els avisos urgents no hi van: `feinaAvisos` ja cobreix els critics, i
 * tornar-los a enviar els duplicaria.
 */
export async function passAll(ambModelLocal: boolean = config.ollamaEnabled): Promise<string> {
  const parts: string[] = [];
  parts.push(await runStep("passada-diaria", dailyPass));
  if (ambModelLocal) {
    parts.push(await runStep("passada-nocturna", nightlyPass));
  }
  parts.push(await runStep("notify", alertsJob));
  parts.push(await runStep("maintenance", maintenanceJob));
  return parts.join("\n");
}
