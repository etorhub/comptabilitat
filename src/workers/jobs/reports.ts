/**
 * Scheduled jobs: the written reports, one workspace at a time.
 *
 * - `dailyReportsJob`: the morning brief, right after the daily pass has
 *   imported yesterday's transactions.
 * - `monthlyReportsJob`: last month's report, from `REPORT_MONTHLY_DAY` on
 *   (banks book some transactions a few days late). It runs every night and
 *   only writes what is missing, so a night when Ollama was down is caught up
 *   the next one, up to `MAX_ATTEMPTS` times.
 *
 * Workspaces go one after another with a pause in between
 * (`REPORT_PAUSE_SECONDS`): the NAS cools down, and a chat question asked
 * meanwhile gets the model before the next report does.
 */

import { asc, eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers, type AiReportKind } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import type { ReportModel } from "../../lib/ollama/client.ts";
import { todayLocal } from "../../lib/time.ts";
import {
  attemptsOf,
  generateReport,
  MAX_ATTEMPTS,
  periodFor,
} from "../../services/ai-reports.ts";
import { hasActivity, lastDayOf } from "../../services/report-facts.ts";

interface RunOptions {
  today?: string;
  model?: ReportModel;
  /** Writes it even if it exists or already failed too often (a person asked). */
  force?: boolean;
}

async function activeWorkspaces() {
  return db
    .select({ id: ledgers.id, name: ledgers.name })
    .from(ledgers)
    .where(eq(ledgers.isActive, true))
    .orderBy(asc(ledgers.position), asc(ledgers.id));
}

async function pause(): Promise<void> {
  if (config.reportPauseSeconds > 0) await Bun.sleep(config.reportPauseSeconds * 1000);
}

async function writeAll(
  kind: AiReportKind,
  period: string,
  range: [string, string],
  options: RunOptions,
): Promise<string> {
  const lines: string[] = [];
  let errors = 0;
  let first = true;

  for (const workspace of await activeWorkspaces()) {
    if (!(await hasActivity(workspace.id, range[0], range[1]))) {
      lines.push(`${workspace.name}: sense moviments, no cal informe`);
      continue;
    }

    if (kind === "monthly" && options.force !== true) {
      const previous = await attemptsOf(workspace.id, kind, period);
      if (previous?.written) {
        lines.push(`${workspace.name}: ja estava fet`);
        continue;
      }
      if (previous && previous.attempts >= MAX_ATTEMPTS) {
        lines.push(`${workspace.name}: ${MAX_ATTEMPTS} intents fallits, cal fer-ho a ma`);
        continue;
      }
    }

    if (!first) await pause();
    first = false;

    const written = await generateReport(workspace, kind, period, options.model);
    if (written) {
      lines.push(`${workspace.name}: fet`);
    } else {
      errors += 1;
      lines.push(`${workspace.name}: ha fallat`);
    }
  }

  const summary = lines.join("\n") || "no hi ha cap espai actiu";
  // `runJob` reads «(N errors)» to mark the run as partial.
  return errors > 0 ? `${summary}\n(${errors} errors)` : summary;
}

/** The morning brief of every active workspace. */
export async function dailyReportsJob(options: RunOptions = {}): Promise<string> {
  if (!config.ollamaEnabled) return "el model local no esta actiu";
  const today = options.today ?? todayLocal();
  return writeAll(
    "daily",
    periodFor("daily", today),
    [`${today.slice(0, 7)}-01`, today],
    options,
  );
}

/** Last month's report of every active workspace, if it is time and it is missing. */
export async function monthlyReportsJob(options: RunOptions = {}): Promise<string> {
  if (!config.ollamaEnabled) return "el model local no esta actiu";
  const today = options.today ?? todayLocal();
  const day = Number(today.slice(8, 10));
  if (day < config.reportMonthlyDay && options.force !== true) {
    return `encara no toca: es fa a partir del dia ${config.reportMonthlyDay}`;
  }
  const month = periodFor("monthly", today);
  return writeAll("monthly", month, [`${month}-01`, lastDayOf(month)], options);
}
