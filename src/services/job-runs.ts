/**
 * Historial i execució de les feines del planificador.
 *
 * Totes les vies (cron, UI, CLI) passen per `executaFeina`, que deixa una
 * fila a `job_runs`. Les passades compostes creen fills amb `executaPas`
 * gràcies a un `AsyncLocalStorage`.
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
const HORES_FINS_A_DONAR_PER_MORTA = 2;

interface RunContext {
  /** Identificador de la fila pare (la passada o la feina de primer nivell). */
  parentId: number;
  trigger: JobTrigger;
}

const context = new AsyncLocalStorage<RunContext>();

/** Heurística: el resum de sync marca errors per connexió sense llançar. */
function semblaParcial(summary: string): boolean {
  return /\(\d+ errors?\)/.test(summary);
}

function truncarError(error: unknown): string {
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
    await closeRun(run.id, "failed", "", truncarError(error));
    throw error;
  }
}

/**
 * Executa una feina de primer nivell (o un pas fill si ja hi ha context) i
 * deixa el resultat a `job_runs`. Espera que acabi.
 */
export async function runJob(
  jobName: string,
  trigger: JobTrigger,
  fn: () => Promise<string>,
): Promise<string> {
  const store = context.getStore();
  if (store !== undefined) {
    // Crida niuada accidental: tracta-la com a pas del pare actual.
    return runStep(jobName, fn);
  }

  const run = await openRun(jobName, trigger, null);
  return context.run({ parentId: run.id, trigger }, () => runAndClose(run, fn));
}

/**
 * Com `executaFeina`, pero torna quan la fila `running` ja existeix i deixa
 * la feina en segon pla. Per a la UI: cal poder redibuixar l'historial abans
 * que acabi (i sense esperar una sincronitzacio llarga).
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
 * Pas d'una passada: crea un fill amb el `parent_id` del context actual.
 * Dins del pas el context apunta a la fila nova, així una passada niuada
 * (p.ex. `totes` → `passada-diaria` → `sync`) encadena els avisos correctament.
 * Fora de context (no hauria de passar) només executa la funció.
 */
export async function runStep(jobName: string, fn: () => Promise<string>): Promise<string> {
  const store = context.getStore();
  if (store === undefined) {
    return fn();
  }

  const run = await openRun(jobName, store.trigger, store.parentId);
  return context.run({ parentId: run.id, trigger: store.trigger }, () => runAndClose(run, fn));
}

/** Hi ha una execució de primer nivell amb aquest nom encara corrent? */
export async function jobRunning(jobName: string): Promise<boolean> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);
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

/** Conjunt de noms de feines (pare o fill) que ara mateix estan `running`. */
export async function runningJobNames(): Promise<Set<string>> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);
  const rows = await db
    .select({ jobName: jobRuns.jobName })
    .from(jobRuns)
    .where(and(eq(jobRuns.status, "running"), gte(jobRuns.startedAt, limit)));
  return new Set(rows.map((f) => f.jobName));
}

export async function readRunning(): Promise<JobRun[]> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);
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
  finsA?: Date;
  /** Pàgina 0-indexada. */
  page: number;
  limit: number;
}

export interface HistoryPage {
  items: JobRun[];
  total: number;
  page: number;
  limit: number;
  /** Fills indexats pel `parent_id`, només dels items de la pàgina. */
  children: Map<number, JobRun[]>;
}

function filterKeys(filters: HistoryFilters) {
  const parts = [isNull(jobRuns.parentId)];
  if (filters.job) parts.push(eq(jobRuns.jobName, filters.job));
  if (filters.state) parts.push(eq(jobRuns.status, filters.state));
  if (filters.origin) parts.push(eq(jobRuns.trigger, filters.origin));
  if (filters.from) parts.push(gte(jobRuns.startedAt, filters.from));
  if (filters.finsA) parts.push(lte(jobRuns.startedAt, filters.finsA));
  return and(...parts);
}

/**
 * Historial de primer nivell amb els fills carregats per a l'expansió.
 * Si es filtra per una feina que pot ser pas (`sync`, …), també es mostren
 * les files fills que hi encaixen (sense amagar-les sota el filtre de pare).
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
        ...(filters.finsA ? [lte(jobRuns.startedAt, filters.finsA)] : []),
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

/** Darrera execució de primer nivell per a cada `job_name` demanat. */
export async function lastRunPerJob(names: string[]): Promise<Map<string, JobRun>> {
  const mapa = new Map<string, JobRun>();
  if (names.length === 0) return mapa;

  // Una consulta per nom: la taula és petita i evitem DISTINCT ON específic
  // de Postgres amb sintaxi fràgil a Drizzle.
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
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);

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

/** Importacions bancàries solapades amb una execució de sync. */
export async function syncRunsForRun(run: JobRun): Promise<SyncRun[]> {
  if (run.jobName !== "sync") return [];
  const inici = run.startedAt;
  const fi = run.finishedAt ?? new Date();
  // Una mica de marge: la feina comença abans d'obrir el primer sync_run.
  const from = new Date(inici.getTime() - 5_000);
  const fins = new Date(fi.getTime() + 5_000);
  return db
    .select()
    .from(syncRuns)
    .where(and(gte(syncRuns.startedAt, from), lte(syncRuns.startedAt, fins)))
    .orderBy(asc(syncRuns.startedAt));
}

/** Marca com a fallides les feines `running` de més de 2 h. */
export async function closeStuckJobs(): Promise<number> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);

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
