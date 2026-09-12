/**
 * The scheduler's composite passes.
 *
 * They live apart from `scheduler.ts` because that file starts the cron when
 * imported: the UI and the CLI must not touch it. Order matters: there is no
 * point classifying before importing, nor analysing recurring series before
 * classifying.
 *
 * Each step goes through `runStep` when it runs inside `runJob`, so the
 * history shows the pass and its children.
 */

import { config } from "../../lib/config.ts";
import { runStep } from "../../services/job-runs.ts";
import { analysisJob } from "./analyze.ts";
import { classificationJob } from "./classify.ts";
import { localModelJob } from "./llm.ts";
import { maintenanceJob } from "./maintenance.ts";
import { alertsJob } from "./notify.ts";
import { syncJob } from "./sync.ts";

/** Import, classify and analyse, in that order. */
export async function dailyPass(): Promise<string> {
  const parts: string[] = [];
  parts.push(await runStep("sync", () => syncJob()));
  parts.push(await runStep("classify", classificationJob));
  parts.push(await runStep("analyze", analysisJob));
  return parts.join("\n");
}

/**
 * The local model looks at the new merchants and then everything is classified
 * again, without the model this time, to spread whatever it proposed.
 */
export async function nightlyPass(): Promise<string> {
  const model = await runStep("llm", () => localModelJob());
  const classification = await runStep("classify", classificationJob);
  return `${model}\n${classification}`;
}

/**
 * Everything the scheduler would end up doing over a day, in one go: the daily
 * pass, the nightly one (when Ollama is there), alerts and maintenance.
 *
 * The urgent alerts are not included: `alertsJob` already covers the critical
 * ones, and sending them again would duplicate them.
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
