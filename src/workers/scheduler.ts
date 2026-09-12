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
import { runJob } from "../services/job-runs.ts";
import { analysisJob } from "./jobs/analyze.ts";
import { maintenanceJob } from "./jobs/maintenance.ts";
import { alertsJob, urgentAlertsJob } from "./jobs/notify.ts";
import { dailyPass, nightlyPass } from "./jobs/pipelines.ts";

validateConfig();

/**
 * Executa una feina sense deixar que un error se'n dugui el planificador.
 *
 * Es el `_run()` del Python: una feina que peta es registra i prou; les altres
 * han de continuar corrent. El resultat queda a `job_runs`.
 */
async function run(name: string, job: () => Promise<string>): Promise<void> {
  const començat = Date.now();
  try {
    const summary = await runJob(name, "scheduled", job);
    console.info(`[${name}] fet en ${Math.round((Date.now() - començat) / 1000)}s\n${summary}`);
  } catch (error) {
    console.error(`[${name}] ha fallat:`, error);
  }
}

function main(): void {
  if (!config.schedulerEnabled) {
    console.info("[planificador] desactivat (SCHEDULER_ENABLED=false)");
    return;
  }

  const options = { timezone: config.timezone, protect: true } as const;
  const jobs: Cron[] = [];

  // La passada diaria. Nomes una: sota PSD2 el banc limita les consultes
  // sense l'usuari present, i abusar-ne les gasta.
  jobs.push(
    new Cron(`${config.syncCronMinute} ${config.syncCronHour} * * *`, options, () =>
      run("passada-diaria", dailyPass),
    ),
  );

  // Una analisi a banda, per si durant el dia s'ha classificat a ma.
  jobs.push(
    new Cron(`45 ${config.analysisCronHour} * * *`, options, () => run("analyze", analysisJob)),
  );

  // El model local, de matinada: en un NAS sense targeta grafica cada
  // pregunta triga segons, i de dia molestaria.
  if (config.ollamaEnabled) {
    jobs.push(
      new Cron(`15 ${config.classifyCronHour} * * *`, options, () =>
        run("passada-nocturna", nightlyPass),
      ),
    );
  }

  // El resum d'avisos, un cop al dia.
  jobs.push(
    new Cron(`0 ${config.notifyCronHour} * * *`, options, () => run("notify", alertsJob)),
  );

  // Els urgents, cada hora: un descobert previst no pot esperar al resum.
  jobs.push(new Cron("5 * * * *", options, () => run("notify-urgents", urgentAlertsJob)));

  // Manteniment: esborra les sessions caducades.
  jobs.push(new Cron("30 4 * * *", options, () => run("maintenance", maintenanceJob)));

  console.info(
    `[planificador] a punt (${config.timezone}). Passada diaria a les ` +
      `${String(config.syncCronHour).padStart(2, "0")}:${String(config.syncCronMinute).padStart(2, "0")}.`,
  );

  const atura = () => {
    console.info("[planificador] aturant-se…");
    for (const job of jobs) job.stop();
    void closeDb().finally(() => process.exit(0));
  };

  process.on("SIGTERM", atura);
  process.on("SIGINT", atura);
}

main();
