/**
 * Planificador de feines.
 *
 * Corre en un proces a part del servidor web, com feia el `worker` de Python
 * amb APScheduler. Sense cua ni intermediari: aixo es una instal·lacio d'una
 * sola maquina.
 *
 * Els horaris surten de les mateixes variables d'entorn que abans
 * (`SYNC_CRON_HOUR`, `CLASSIFY_CRON_HOUR`, `ANALYSIS_CRON_HOUR`,
 * `NOTIFY_CRON_HOUR`), de manera que el `deploy/.env` que ja hi ha continua
 * servint sense tocar-hi res.
 *
 *   bun run src/workers/scheduler.ts
 */

import { Cron } from "croner";

import { closeDb } from "../db/client.ts";
import { config, validateConfig } from "../lib/config.ts";
import { feinaAnalisi } from "./jobs/analyze.ts";
import { feinaClassificacio } from "./jobs/classify.ts";
import { feinaModelLocal } from "./jobs/llm.ts";
import { feinaManteniment } from "./jobs/maintenance.ts";
import { feinaAvisos, feinaAvisosUrgents } from "./jobs/notify.ts";
import { feinaSincronitzacio } from "./jobs/sync.ts";

validateConfig();

/**
 * Executa una feina sense deixar que un error se'n dugui el planificador.
 *
 * Es el `_run()` del Python: una feina que peta es registra i prou; les altres
 * han de continuar corrent.
 */
async function corre(nom: string, feina: () => Promise<string>): Promise<void> {
  const començat = Date.now();
  try {
    const resum = await feina();
    console.info(`[${nom}] fet en ${Math.round((Date.now() - començat) / 1000)}s\n${resum}`);
  } catch (error) {
    console.error(`[${nom}] ha fallat:`, error);
  }
}

/**
 * La passada diaria: importar, classificar i analitzar, en aquest ordre.
 *
 * L'ordre importa: no te sentit classificar abans d'haver importat, ni
 * analitzar recurrents abans d'haver classificat.
 */
async function passadaDiaria(): Promise<string> {
  const trossos: string[] = [];
  trossos.push(await feinaSincronitzacio());
  trossos.push(await feinaClassificacio());
  trossos.push(await feinaAnalisi());
  return trossos.join("\n");
}

/**
 * La passada nocturna: el model local mira els comerços nous i despres es
 * torna a classificar, ja sense model, per escampar el que hagi proposat.
 */
async function passadaNocturna(): Promise<string> {
  const model = await feinaModelLocal();
  const classificacio = await feinaClassificacio();
  return `${model}\n${classificacio}`;
}

function main(): void {
  if (!config.schedulerEnabled) {
    console.info("[planificador] desactivat (SCHEDULER_ENABLED=false)");
    return;
  }

  const opcions = { timezone: config.timezone, protect: true } as const;
  const feines: Cron[] = [];

  // La passada diaria. Nomes una: sota PSD2 el banc limita les consultes
  // sense l'usuari present, i abusar-ne les gasta.
  feines.push(
    new Cron(
      `${config.syncCronMinute} ${config.syncCronHour} * * *`,
      opcions,
      () => corre("passada-diaria", passadaDiaria),
    ),
  );

  // Una analisi a banda, per si durant el dia s'ha classificat a ma.
  feines.push(
    new Cron(`45 ${config.analysisCronHour} * * *`, opcions, () =>
      corre("analisi", feinaAnalisi),
    ),
  );

  // El model local, de matinada: en un NAS sense targeta grafica cada
  // pregunta triga segons, i de dia molestaria.
  if (config.ollamaEnabled) {
    feines.push(
      new Cron(`15 ${config.classifyCronHour} * * *`, opcions, () =>
        corre("model-local", passadaNocturna),
      ),
    );
  }

  // El resum d'avisos, un cop al dia.
  feines.push(
    new Cron(`0 ${config.notifyCronHour} * * *`, opcions, () => corre("avisos", feinaAvisos)),
  );

  // Els urgents, cada hora: un descobert previst no pot esperar al resum.
  feines.push(new Cron("5 * * * *", opcions, () => corre("avisos-urgents", feinaAvisosUrgents)));

  // Manteniment: esborra les sessions caducades.
  feines.push(new Cron("30 4 * * *", opcions, () => corre("manteniment", feinaManteniment)));

  console.info(
    `[planificador] a punt (${config.timezone}). Passada diaria a les ` +
      `${String(config.syncCronHour).padStart(2, "0")}:${String(config.syncCronMinute).padStart(2, "0")}.`,
  );

  const atura = () => {
    console.info("[planificador] aturant-se…");
    for (const feina of feines) feina.stop();
    void closeDb().finally(() => process.exit(0));
  };

  process.on("SIGTERM", atura);
  process.on("SIGINT", atura);
}

main();
