/**
 * History and execution of the scheduler's jobs.
 *
 * Every route (cron, UI, CLI) goes through `runJob`, which leaves a row in
 * `job_runs`. Composite passes create children with `runStep` thanks to an
 * `AsyncLocalStorage`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  type JobRun,
  type JobStatus,
  type JobTrigger,
  jobRuns,
  type SyncRun,
  syncRuns,
} from "../db/schema/index.ts";

const ERROR_MAX = 2000;
const HOURS_UNTIL_PRESUMED_DEAD = 2;

interface RunContext {
  /** Id of the parent row (the pass or the top-level job). */
  parentId: number;
  trigger: JobTrigger;
}

const context = new AsyncLocalStorage<RunContext>();

/** Heuristic: the sync summary marks errors per connection without throwing. */
function semblaParcial(summary: string): boolean {
  return /\(\d+ errors?\)/.test(summary);
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, ERROR_MAX);
}

async function openRun(
  jobName: string,
  trigger: JobTrigger,
  parentId: number | null,
): Promise<JobRun> {
  const [row] = await db
    .insert(jobRuns)
    .values({
      jobName,
      trigger,
      status: "running",
      parentId,
      startedAt: new Date(),
      summary: "",
      error: "",
    })
    .returning();
  if (row === undefined) throw new Error("No s'ha pogut obrir l'execució de la feina");
  return row;
}

async function closeRun(
  id: number,
  status: JobStatus,
  summary: string,
  error: string,
): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      status,
      finishedAt: new Date(),
      summary,
      error: error.slice(0, ERROR_MAX),
    })
    .where(eq(jobRuns.id, id));
}

async function runAndClose(run: JobRun, fn: () => Promise<string>): Promise<string> {
  try {
    const summary = await fn();
    const status: JobStatus = semblaParcial(summary) ? "partial" : "success";
    await closeRun(run.id, status, summary, "");
    return summary;
  } catch (error) {
    await closeRun(run.id, "failed", "", truncateError(error));
    throw error;
  }
}

/**
 * Runs a top-level job (or a child step if there is already a context) and
 * leaves the result in `job_runs`. It waits for it to finish.
 */
export async function runJob(
  jobName: string,
  trigger: JobTrigger,
  fn: () => Promise<string>,
): Promise<string> {
  const store = context.getStore();
  if (store !== undefined) {
    // Accidental nested call: treat it as a step of the current parent.
    return runStep(jobName, fn);
  }

  const run = await openRun(jobName, trigger, null);
  return context.run({ parentId: run.id, trigger }, () => runAndClose(run, fn));
}

/**
 * Like `runJob`, but returns once the `running` row exists and leaves the job
 * in the background. For the UI: the history has to be redrawable before it
 * finishes (and without waiting for a long synchronization).
 */
export async function startJob(
  jobName: string,
  trigger: JobTrigger,
  fn: () => Promise<string>,
): Promise<JobRun> {
  if (context.getStore() !== undefined) {
    throw new Error("engegaFeina no es pot cridar dins d'una altra feina");
  }

  const run = await openRun(jobName, trigger, null);
  const començat = Date.now();
  void context.run({ parentId: run.id, trigger }, async () => {
    try {
      const summary = await runAndClose(run, fn);
      console.info(
        `[${jobName}] fet en ${Math.round((Date.now() - començat) / 1000)}s\n${summary}`,
      );
    } catch (error) {
      console.error(`[${jobName}] ha fallat:`, error);
    }
  });
  return run;
}

/**
 * A step of a pass: creates a child with the current context's `parent_id`.
 * Inside the step the context points at the new row, so a nested pass
 * (e.g. `totes` → `passada-diaria` → `sync`) chains the notices correctly.
 * Outside a context (which should not happen) it just runs the function.
 */
export async function runStep(jobName: string, fn: () => Promise<string>): Promise<string> {
  const store = context.getStore();
  if (store === undefined) {
    return fn();
  }

  const run = await openRun(jobName, store.trigger, store.parentId);
  return context.run({ parentId: run.id, trigger: store.trigger }, () => runAndClose(run, fn));
}

/** Is there a top-level run with this name still going? */
export async function jobRunning(jobName: string): Promise<boolean> {
  const limit = new Date(Date.now() - HOURS_UNTIL_PRESUMED_DEAD * 60 * 60 * 1000);
  const [viva] = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.jobName, jobName),
        eq(jobRuns.status, "running"),
        isNull(jobRuns.parentId),
        gte(jobRuns.startedAt, limit),
      ),
    )
    .limit(1);
  return viva !== undefined;
}

/** Set of job names (parent or child) that are `running` right now. */
export async function runningJobNames(): Promise<Set<string>> {
  const limit = new Date(Date.now() - HOURS_UNTIL_PRESUMED_DEAD * 60 * 60 * 1000);
  const rows = await db
    .select({ jobName: jobRuns.jobName })
    .from(jobRuns)
    .where(and(eq(jobRuns.status, "running"), gte(jobRuns.startedAt, limit)));
  return new Set(rows.map((f) => f.jobName));
}

export async function readRunning(): Promise<JobRun[]> {
  const limit = new Date(Date.now() - HOURS_UNTIL_PRESUMED_DEAD * 60 * 60 * 1000);
  return db
    .select()
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.status, "running"),
        isNull(jobRuns.parentId),
        gte(jobRuns.startedAt, limit),
      ),
    )
    .orderBy(asc(jobRuns.startedAt));
}

export interface HistoryFilters {
  job?: string;
  state?: JobStatus;
  origin?: JobTrigger;
  from?: Date;
  until?: Date;
  /** 0-indexed page. */
  page: number;
  limit: number;
}

export interface HistoryPage {
  items: JobRun[];
  total: number;
  page: number;
  limit: number;
  /** Children indexed by `parent_id`, only for the items on the page. */
  children: Map<number, JobRun[]>;
}

function filterKeys(filters: HistoryFilters) {
  const parts = [isNull(jobRuns.parentId)];
  if (filters.job) parts.push(eq(jobRuns.jobName, filters.job));
  if (filters.state) parts.push(eq(jobRuns.status, filters.state));
  if (filters.origin) parts.push(eq(jobRuns.trigger, filters.origin));
  if (filters.from) parts.push(gte(jobRuns.startedAt, filters.from));
  if (filters.until) parts.push(lte(jobRuns.startedAt, filters.until));
  return and(...parts);
}

/**
 * Top-level history with the children loaded for the expansion.
 * If it is filtered by a job that can be a step (`sync`, …), the matching
 * child rows are shown too (without hiding them under the parent filter).
 */
export async function readHistory(filters: HistoryFilters): Promise<HistoryPage> {
  const onlyChildren =
    filters.job !== undefined &&
    !["passada-diaria", "passada-nocturna", "totes"].includes(filters.job);

  const where = onlyChildren
    ? and(
        ...(filters.job ? [eq(jobRuns.jobName, filters.job)] : []),
        ...(filters.state ? [eq(jobRuns.status, filters.state)] : []),
        ...(filters.origin ? [eq(jobRuns.trigger, filters.origin)] : []),
        ...(filters.from ? [gte(jobRuns.startedAt, filters.from)] : []),
        ...(filters.until ? [lte(jobRuns.startedAt, filters.until)] : []),
      )
    : filterKeys(filters);

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(jobRuns)
    .where(where);

  const items = await db
    .select()
    .from(jobRuns)
    .where(where)
    .orderBy(desc(jobRuns.startedAt))
    .limit(filters.limit)
    .offset(filters.page * filters.limit);

  const children = new Map<number, JobRun[]>();
  if (!onlyChildren && items.length > 0) {
    const ids = items.map((i) => i.id);
    const childRows = await db
      .select()
      .from(jobRuns)
      .where(inArray(jobRuns.parentId, ids))
      .orderBy(asc(jobRuns.startedAt));
    for (const child of childRows) {
      if (child.parentId === null) continue;
      const list = children.get(child.parentId) ?? [];
      list.push(child);
      children.set(child.parentId, list);
    }
  }

  return { items, total: Number(total), page: filters.page, limit: filters.limit, children };
}

export async function readRun(id: number): Promise<JobRun | null> {
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.id, id)).limit(1);
  return row ?? null;
}

export async function readChildren(parentId: number): Promise<JobRun[]> {
  return db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.parentId, parentId))
    .orderBy(asc(jobRuns.startedAt));
}

/** Last top-level run for each `job_name` asked for. */
export async function lastRunPerJob(names: string[]): Promise<Map<string, JobRun>> {
  const mapa = new Map<string, JobRun>();
  if (names.length === 0) return mapa;

  // One query per name: the table is small and it saves us a Postgres-specific
  // DISTINCT ON with fragile syntax in Drizzle.
  await Promise.all(
    names.map(async (name) => {
      const [row] = await db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.jobName, name), isNull(jobRuns.parentId)))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      if (row) mapa.set(name, row);
    }),
  );
  return mapa;
}

export interface HealthSummary {
  enCurs: number;
  fallades24h: number;
  darreraPassadaDiaria: JobRun | null;
}

export async function summaryHealth(): Promise<HealthSummary> {
  const fa24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const limit = new Date(Date.now() - HOURS_UNTIL_PRESUMED_DEAD * 60 * 60 * 1000);

  const [{ enCurs } = { enCurs: 0 }] = await db
    .select({ enCurs: count() })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.status, "running"),
        isNull(jobRuns.parentId),
        gte(jobRuns.startedAt, limit),
      ),
    );

  const [{ fallades24h } = { fallades24h: 0 }] = await db
    .select({ fallades24h: count() })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.status, "failed"),
        isNull(jobRuns.parentId),
        gte(jobRuns.startedAt, fa24h),
      ),
    );

  const [darreraPassadaDiaria = null] = await db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, "passada-diaria"), isNull(jobRuns.parentId)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  return {
    enCurs: Number(enCurs),
    fallades24h: Number(fallades24h),
    darreraPassadaDiaria,
  };
}

/** Bank imports overlapping with a sync run. */
export async function syncRunsForRun(run: JobRun): Promise<SyncRun[]> {
  if (run.jobName !== "sync") return [];
  const inici = run.startedAt;
  const fi = run.finishedAt ?? new Date();
  // A little margin: the job starts before opening the first sync_run.
  const from = new Date(inici.getTime() - 5_000);
  const to = new Date(fi.getTime() + 5_000);
  return db
    .select()
    .from(syncRuns)
    .where(and(gte(syncRuns.startedAt, from), lte(syncRuns.startedAt, to)))
    .orderBy(asc(syncRuns.startedAt));
}

/** Marks `running` jobs older than 2 h as failed. */
export async function closeStuckJobs(): Promise<number> {
  const limit = new Date(Date.now() - HOURS_UNTIL_PRESUMED_DEAD * 60 * 60 * 1000);

  const tancades = await db
    .update(jobRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "La feina es va quedar a mitges (el procés es va aturar).",
    })
    .where(and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, limit)))
    .returning({ id: jobRuns.id });

  if (tancades.length > 0) {
    console.warn(`[feines] ${tancades.length} execucions penjades donades per fallides`);
  }
  return tancades.length;
}
