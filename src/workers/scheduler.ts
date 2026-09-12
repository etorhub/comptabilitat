/**
 * The job scheduler.
 *
 * It runs in a process separate from the web server, as Python's `worker` did
 * with APScheduler. No queue and no broker: this is a single-machine
 * installation.
 *
 * The schedules come from the same environment variables as before
 * (`SYNC_CRON_HOUR`, `CLASSIFY_CRON_HOUR`, `ANALYSIS_CRON_HOUR`,
 * `NOTIFY_CRON_HOUR`), so the existing `deploy/.env` keeps working
 * untouched.
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
 * Runs a job without letting an error take the scheduler down with it.
 *
 * This is Python's `_run()`: a job that blows up is logged and that is all;
 * the others have to keep running. The result lands in `job_runs`.
 */
async function run(name: string, job: () => Promise<string>): Promise<void> {
  const startedAt = Date.now();
  try {
    const summary = await runJob(name, "scheduled", job);
    console.info(
      `[${name}] fet en ${Math.round((Date.now() - startedAt) / 1000)}s\n${summary}`,
    );
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

  // The daily pass. Only one: under PSD2 the bank limits queries made without
  // the user present, and overusing them spends the allowance.
  jobs.push(
    new Cron(`${config.syncCronMinute} ${config.syncCronHour} * * *`, options, () =>
      run("passada-diaria", dailyPass),
    ),
  );

  // A separate analysis, in case anything was categorised by hand during the day.
  jobs.push(
    new Cron(`45 ${config.analysisCronHour} * * *`, options, () => run("analyze", analysisJob)),
  );

  // The local model, in the small hours: on a NAS without a graphics card
  // each question takes seconds, and during the day it would get in the way.
  if (config.ollamaEnabled) {
    jobs.push(
      new Cron(`15 ${config.classifyCronHour} * * *`, options, () =>
        run("passada-nocturna", nightlyPass),
      ),
    );
  }

  // The alert summary, once a day.
  jobs.push(
    new Cron(`0 ${config.notifyCronHour} * * *`, options, () => run("notify", alertsJob)),
  );

  // The urgent ones hourly: a projected overdraft cannot wait for the summary.
  jobs.push(new Cron("5 * * * *", options, () => run("notify-urgents", urgentAlertsJob)));

  // Maintenance: deletes expired sessions.
  jobs.push(new Cron("30 4 * * *", options, () => run("maintenance", maintenanceJob)));

  console.info(
    `[planificador] a punt (${config.timezone}). Passada diaria a les ` +
      `${String(config.syncCronHour).padStart(2, "0")}:${String(config.syncCronMinute).padStart(2, "0")}.`,
  );

  const stop = () => {
    console.info("[planificador] aturant-se…");
    for (const job of jobs) job.stop();
    void closeDb().finally(() => process.exit(0));
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main();
