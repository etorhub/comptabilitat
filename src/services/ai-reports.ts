/**
 * The reports the local model writes: the morning brief and the monthly one.
 *
 * The figures come from `report-facts.ts`; the model only writes the prose.
 * A report's `facts` and `text` are replaced **together**, and only when the
 * model has answered: a regeneration that fails leaves the previous report
 * standing (with the failure noted), and without a model there is no report
 * at all — the page draws nothing but the empty state.
 *
 * Every lookup takes the workspace: the period comes from the URL, and another
 * workspace's report is a 404 like one that does not exist.
 */

import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { aiReports, type AiReport, type AiReportKind } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { OllamaError, OllamaReportModel, type ReportModel } from "../lib/ollama/client.ts";
import {
  buildDailyPrompt,
  buildMonthlyPrompt,
  REPORT_PROMPT_VERSION,
  REPORT_SYSTEM_PROMPT,
} from "../lib/ollama/report-prompts.ts";
import { addDays, todayLocal } from "../lib/time.ts";
import { dailyFacts, monthlyFacts, shiftMonth, type ReportFacts } from "./report-facts.ts";

/** A scheduled report that failed this many times is left alone until someone asks. */
export const MAX_ATTEMPTS = 3;

/** How long a daily brief is kept. The monthly ones stay for ever. */
export const DAILY_RETENTION_DAYS = 40;

/** The period each kind is about on a given day: today, or last month. */
export function periodFor(kind: AiReportKind, today: string = todayLocal()): string {
  return kind === "daily" ? today : shiftMonth(today.slice(0, 7), -1);
}

/** What the page needs; never the row as a whole type from `routes/`. */
export interface ReportView {
  kind: AiReportKind;
  period: string;
  status: AiReport["status"];
  facts: ReportFacts | null;
  text: { resum: string; punts: string[] } | null;
  error: string;
  finishedAt: Date | null;
}

const Fields = {
  kind: aiReports.kind,
  period: aiReports.period,
  status: aiReports.status,
  facts: aiReports.facts,
  text: aiReports.text,
  error: aiReports.error,
  finishedAt: aiReports.finishedAt,
} as const;

function view(row: {
  kind: AiReportKind;
  period: string;
  status: AiReport["status"];
  facts: Record<string, unknown> | null;
  text: { resum: string; punts: string[] } | null;
  error: string;
  finishedAt: Date | null;
}): ReportView {
  return { ...row, facts: row.facts as ReportFacts | null };
}

// --- Reading -------------------------------------------------------------------

/** One report of this workspace, or null. */
export async function reportOf(
  ledgerId: number,
  kind: AiReportKind,
  period: string,
): Promise<ReportView | null> {
  const [row] = await db
    .select(Fields)
    .from(aiReports)
    .where(
      and(
        eq(aiReports.ledgerId, ledgerId),
        eq(aiReports.kind, kind),
        eq(aiReports.period, period),
      ),
    )
    .limit(1);
  return row ? view(row) : null;
}

/** The most recent daily brief, written or still being written. */
export async function latestDaily(ledgerId: number): Promise<ReportView | null> {
  const [row] = await db
    .select(Fields)
    .from(aiReports)
    .where(and(eq(aiReports.ledgerId, ledgerId), eq(aiReports.kind, "daily")))
    .orderBy(desc(aiReports.period))
    .limit(1);
  return row ? view(row) : null;
}

export interface MonthlyEntry {
  period: string;
  resum: string;
}

/** The monthly reports that have been written, newest first. */
export async function monthlyList(ledgerId: number): Promise<MonthlyEntry[]> {
  const rows = await db
    .select({ period: aiReports.period, text: aiReports.text })
    .from(aiReports)
    .where(
      and(
        eq(aiReports.ledgerId, ledgerId),
        eq(aiReports.kind, "monthly"),
        isNotNull(aiReports.text),
      ),
    )
    .orderBy(desc(aiReports.period));
  return rows.map((r) => ({ period: r.period, resum: r.text?.resum ?? "" }));
}

/** Whether a report is being written right now (and has not been for suspiciously long). */
export async function isPending(
  ledgerId: number,
  kind: AiReportKind,
  period: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: aiReports.id })
    .from(aiReports)
    .where(
      and(
        eq(aiReports.ledgerId, ledgerId),
        eq(aiReports.kind, kind),
        eq(aiReports.period, period),
        eq(aiReports.status, "pending"),
        sql`${aiReports.startedAt} > now() - make_interval(secs => ${stuckAfterSeconds()})`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Scheduled failures so far, for the catch-up rule. */
export async function attemptsOf(
  ledgerId: number,
  kind: AiReportKind,
  period: string,
): Promise<{ attempts: number; written: boolean } | null> {
  const [row] = await db
    .select({ attempts: aiReports.attempts, text: aiReports.text })
    .from(aiReports)
    .where(
      and(
        eq(aiReports.ledgerId, ledgerId),
        eq(aiReports.kind, kind),
        eq(aiReports.period, period),
      ),
    )
    .limit(1);
  return row ? { attempts: row.attempts, written: row.text !== null } : null;
}

// --- Writing -------------------------------------------------------------------

/**
 * Marks the report as being written, creating its row if needed.
 *
 * What was written before stays where it is until the new text arrives.
 */
export async function markPending(
  ledgerId: number,
  kind: AiReportKind,
  period: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(aiReports)
    .values({
      ledgerId,
      kind,
      period,
      status: "pending",
      model: "",
      promptVersion: REPORT_PROMPT_VERSION,
      error: "",
      attempts: 0,
      startedAt: now,
    })
    .onConflictDoUpdate({
      target: [aiReports.ledgerId, aiReports.kind, aiReports.period],
      set: { status: "pending", error: "", startedAt: now, finishedAt: null },
    });
}

function where(ledgerId: number, kind: AiReportKind, period: string) {
  return and(
    eq(aiReports.ledgerId, ledgerId),
    eq(aiReports.kind, kind),
    eq(aiReports.period, period),
  );
}

async function fail(
  ledgerId: number,
  kind: AiReportKind,
  period: string,
  reason: string,
): Promise<void> {
  // A report that was already written keeps showing: it is still right, only
  // the new attempt failed.
  await db
    .update(aiReports)
    .set({
      status: sql`case when ${aiReports.text} is null then 'error' else 'done' end`,
      error: reason.slice(0, 500),
      attempts: sql`${aiReports.attempts} + 1`,
      finishedAt: new Date(),
    })
    .where(where(ledgerId, kind, period));
}

/**
 * Writes one report from start to end.
 *
 * Never throws: whatever happens ends as `done` or `error` on the row, so the
 * page's poll always has something to stop on. Returns whether it was written.
 */
export async function generateReport(
  workspace: { id: number; name: string },
  kind: AiReportKind,
  period: string,
  model: ReportModel = new OllamaReportModel(),
): Promise<boolean> {
  await markPending(workspace.id, kind, period);

  if (!config.ollamaEnabled) {
    await fail(workspace.id, kind, period, "El model local no està activat");
    return false;
  }

  try {
    const facts =
      kind === "daily"
        ? await dailyFacts(workspace.id, period)
        : await monthlyFacts(workspace.id, period);
    const prompt =
      facts.kind === "daily"
        ? buildDailyPrompt(workspace.name, facts)
        : buildMonthlyPrompt(workspace.name, facts);

    const text = await model.write(REPORT_SYSTEM_PROMPT, prompt);

    await db
      .update(aiReports)
      .set({
        status: "done",
        facts: facts as unknown as Record<string, unknown>,
        text,
        model: model.model,
        promptVersion: REPORT_PROMPT_VERSION,
        error: "",
        attempts: 0,
        finishedAt: new Date(),
      })
      .where(where(workspace.id, kind, period));
    return true;
  } catch (error) {
    // Only the model's own errors reach the screen: anything else (the
    // database, say) can carry data that must not be shown.
    const reason =
      error instanceof OllamaError ? error.message : "No s'ha pogut redactar l'informe";
    if (!(error instanceof OllamaError)) console.error("[informes] ha fallat:", error);
    await fail(workspace.id, kind, period, reason);
    return false;
  }
}

// --- The web queue -------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();

/**
 * Regenerates a report in the background, after whatever is already queued.
 *
 * One at a time, like the chat: Ollama answers one request at a time anyway,
 * and piling requests up on a NAS only makes all of them slower.
 */
export function enqueueReport(
  workspace: { id: number; name: string },
  kind: AiReportKind,
  period: string,
  model?: ReportModel,
): Promise<void> {
  const run = queue.then(async () => {
    await generateReport(workspace, kind, period, model);
  });
  queue = run.catch((error: unknown) => {
    console.error("[informes] la regeneracio ha fallat:", error);
  });
  return queue;
}

/** Resolves once everything queued so far is written. For tests and for shutting down. */
export function reportQueueIdle(): Promise<void> {
  return queue;
}

// --- Housekeeping --------------------------------------------------------------

/** One model call, twice over, is long past lost. */
function stuckAfterSeconds(): number {
  return config.ollamaReportTimeoutSeconds * 2;
}

/** Closes reports left `pending` by a process that died midway. */
export async function failStuckReports(
  olderThanSeconds: number = stuckAfterSeconds(),
): Promise<number> {
  const rows = await db
    .update(aiReports)
    .set({
      status: sql`case when ${aiReports.text} is null then 'error' else 'done' end`,
      error: "La redacció es va interrompre",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(aiReports.status, "pending"),
        sql`${aiReports.startedAt} <= now() - make_interval(secs => ${olderThanSeconds})`,
      ),
    )
    .returning({ id: aiReports.id });
  return rows.length;
}

/** Deletes the daily briefs older than the retention. */
export async function pruneDailyReports(today: string = todayLocal()): Promise<number> {
  const rows = await db
    .delete(aiReports)
    .where(
      and(
        eq(aiReports.kind, "daily"),
        lt(aiReports.period, addDays(today, -DAILY_RETENTION_DAYS)),
      ),
    )
    .returning({ id: aiReports.id });
  return rows.length;
}
