/**
 * Running the jobs by hand.
 *
 * The command names stay Catalan: they are the operator's interface.
 *
 *   bun run src/workers/cli.ts sync [--connexio 1] [--dies 30]
 *   bun run src/workers/cli.ts classify
 *   bun run src/workers/cli.ts llm [--limit 50]
 *   bun run src/workers/cli.ts analyze
 *   bun run src/workers/cli.ts notify [--urgents]
 *   bun run src/workers/cli.ts maintenance
 *   bun run src/workers/cli.ts reassign-normalization [--espai 1]
 *
 * The equivalent of the old `python -m app.cli sync|classify|analyze|notify`.
 * Jobs with a history go through `runJob` (trigger `cli`).
 */

import { closeDb } from "../db/client.ts";
import { runJob } from "../services/job-runs.ts";
import { reassignNormalization } from "../services/merchants.ts";
import { analysisJob } from "./jobs/analyze.ts";
import { classificationJob } from "./jobs/classify.ts";
import { localModelJob } from "./jobs/llm.ts";
import { maintenanceJob } from "./jobs/maintenance.ts";
import { alertsJob, urgentAlertsJob } from "./jobs/notify.ts";
import { syncJob } from "./jobs/sync.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const enter = (name: string): number | null => {
  const value = Number.parseInt(arg(name) ?? "", 10);
  return Number.isNaN(value) ? null : value;
};

const jobs: Record<string, () => Promise<string>> = {
  sync: () =>
    runJob("sync", "cli", () =>
      syncJob({ connectionId: enter("connexio"), daysBack: enter("dies") }),
    ),
  classify: () => runJob("classify", "cli", classificationJob),
  llm: () => runJob("llm", "cli", () => localModelJob(enter("limit") ?? 50)),
  analyze: () => runJob("analyze", "cli", analysisJob),
  notify: () =>
    runJob(process.argv.includes("--urgents") ? "notify-urgents" : "notify", "cli", () =>
      process.argv.includes("--urgents") ? urgentAlertsJob() : alertsJob(),
    ),
  maintenance: () => runJob("maintenance", "cli", maintenanceJob),
  "reassign-normalization": async () => {
    const workspace = enter("espai");
    const r = await reassignNormalization(workspace ?? undefined);
    return `${r.changed} de ${r.reviewed} moviments reassignats`;
  },
};

const order = process.argv[2];
const job = order === undefined ? undefined : jobs[order];

if (job === undefined) {
  console.error(`Feines: ${Object.keys(jobs).join(", ")}`);
  process.exit(1);
}

try {
  console.log(await job());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
