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

interface ContextExecucio {
  /** Identificador de la fila pare (la passada o la feina de primer nivell). */
  parentId: number;
  trigger: JobTrigger;
}

const context = new AsyncLocalStorage<ContextExecucio>();

/** Heurística: el resum de sync marca errors per connexió sense llançar. */
function semblaParcial(resum: string): boolean {
  return /\(\d+ errors?\)/.test(resum);
}

function truncarError(error: unknown): string {
  const missatge = error instanceof Error ? error.message : String(error);
  return missatge.slice(0, ERROR_MAX);
}

async function obreExecucio(
  jobName: string,
  trigger: JobTrigger,
  parentId: number | null,
): Promise<JobRun> {
  const [fila] = await db
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
  if (fila === undefined) throw new Error("No s'ha pogut obrir l'execució de la feina");
  return fila;
}

async function tancaExecucio(
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

async function correITanca(run: JobRun, fn: () => Promise<string>): Promise<string> {
  try {
    const resum = await fn();
    const status: JobStatus = semblaParcial(resum) ? "partial" : "success";
    await tancaExecucio(run.id, status, resum, "");
    return resum;
  } catch (error) {
    await tancaExecucio(run.id, "failed", "", truncarError(error));
    throw error;
  }
}

/**
 * Executa una feina de primer nivell (o un pas fill si ja hi ha context) i
 * deixa el resultat a `job_runs`. Espera que acabi.
 */
export async function executaFeina(
  jobName: string,
  trigger: JobTrigger,
  fn: () => Promise<string>,
): Promise<string> {
  const store = context.getStore();
  if (store !== undefined) {
    // Crida niuada accidental: tracta-la com a pas del pare actual.
    return executaPas(jobName, fn);
  }

  const run = await obreExecucio(jobName, trigger, null);
  return context.run({ parentId: run.id, trigger }, () => correITanca(run, fn));
}

/**
 * Com `executaFeina`, pero torna quan la fila `running` ja existeix i deixa
 * la feina en segon pla. Per a la UI: cal poder redibuixar l'historial abans
 * que acabi (i sense esperar una sincronitzacio llarga).
 */
export async function engegaFeina(
  jobName: string,
  trigger: JobTrigger,
  fn: () => Promise<string>,
): Promise<JobRun> {
  if (context.getStore() !== undefined) {
    throw new Error("engegaFeina no es pot cridar dins d'una altra feina");
  }

  const run = await obreExecucio(jobName, trigger, null);
  const començat = Date.now();
  void context.run({ parentId: run.id, trigger }, async () => {
    try {
      const resum = await correITanca(run, fn);
      console.info(
        `[${jobName}] fet en ${Math.round((Date.now() - començat) / 1000)}s\n${resum}`,
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
export async function executaPas(jobName: string, fn: () => Promise<string>): Promise<string> {
  const store = context.getStore();
  if (store === undefined) {
    return fn();
  }

  const run = await obreExecucio(jobName, store.trigger, store.parentId);
  return context.run({ parentId: run.id, trigger: store.trigger }, () => correITanca(run, fn));
}

/** Hi ha una execució de primer nivell amb aquest nom encara corrent? */
export async function feinaEnCurs(jobName: string): Promise<boolean> {
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
export async function nomsEnCurs(): Promise<Set<string>> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);
  const files = await db
    .select({ jobName: jobRuns.jobName })
    .from(jobRuns)
    .where(and(eq(jobRuns.status, "running"), gte(jobRuns.startedAt, limit)));
  return new Set(files.map((f) => f.jobName));
}

export async function llegeixEnCurs(): Promise<JobRun[]> {
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

export interface FiltresHistorial {
  feina?: string;
  estat?: JobStatus;
  origen?: JobTrigger;
  desDe?: Date;
  finsA?: Date;
  /** Pàgina 0-indexada. */
  pagina: number;
  limit: number;
}

export interface PaginaHistorial {
  items: JobRun[];
  total: number;
  pagina: number;
  limit: number;
  /** Fills indexats pel `parent_id`, només dels items de la pàgina. */
  fills: Map<number, JobRun[]>;
}

function clausFiltres(filtres: FiltresHistorial) {
  const parts = [isNull(jobRuns.parentId)];
  if (filtres.feina) parts.push(eq(jobRuns.jobName, filtres.feina));
  if (filtres.estat) parts.push(eq(jobRuns.status, filtres.estat));
  if (filtres.origen) parts.push(eq(jobRuns.trigger, filtres.origen));
  if (filtres.desDe) parts.push(gte(jobRuns.startedAt, filtres.desDe));
  if (filtres.finsA) parts.push(lte(jobRuns.startedAt, filtres.finsA));
  return and(...parts);
}

/**
 * Historial de primer nivell amb els fills carregats per a l'expansió.
 * Si es filtra per una feina que pot ser pas (`sync`, …), també es mostren
 * les files fills que hi encaixen (sense amagar-les sota el filtre de pare).
 */
export async function llegeixHistorial(filtres: FiltresHistorial): Promise<PaginaHistorial> {
  const nomesFills =
    filtres.feina !== undefined &&
    !["passada-diaria", "passada-nocturna", "totes"].includes(filtres.feina);

  const where = nomesFills
    ? and(
        ...(filtres.feina ? [eq(jobRuns.jobName, filtres.feina)] : []),
        ...(filtres.estat ? [eq(jobRuns.status, filtres.estat)] : []),
        ...(filtres.origen ? [eq(jobRuns.trigger, filtres.origen)] : []),
        ...(filtres.desDe ? [gte(jobRuns.startedAt, filtres.desDe)] : []),
        ...(filtres.finsA ? [lte(jobRuns.startedAt, filtres.finsA)] : []),
      )
    : clausFiltres(filtres);

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(jobRuns)
    .where(where);

  const items = await db
    .select()
    .from(jobRuns)
    .where(where)
    .orderBy(desc(jobRuns.startedAt))
    .limit(filtres.limit)
    .offset(filtres.pagina * filtres.limit);

  const fills = new Map<number, JobRun[]>();
  if (!nomesFills && items.length > 0) {
    const ids = items.map((i) => i.id);
    const fillsFiles = await db
      .select()
      .from(jobRuns)
      .where(inArray(jobRuns.parentId, ids))
      .orderBy(asc(jobRuns.startedAt));
    for (const fill of fillsFiles) {
      if (fill.parentId === null) continue;
      const llista = fills.get(fill.parentId) ?? [];
      llista.push(fill);
      fills.set(fill.parentId, llista);
    }
  }

  return { items, total: Number(total), pagina: filtres.pagina, limit: filtres.limit, fills };
}

export async function llegeixExecucio(id: number): Promise<JobRun | null> {
  const [fila] = await db.select().from(jobRuns).where(eq(jobRuns.id, id)).limit(1);
  return fila ?? null;
}

export async function llegeixFills(parentId: number): Promise<JobRun[]> {
  return db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.parentId, parentId))
    .orderBy(asc(jobRuns.startedAt));
}

/** Darrera execució de primer nivell per a cada `job_name` demanat. */
export async function darreresPerFeina(noms: string[]): Promise<Map<string, JobRun>> {
  const mapa = new Map<string, JobRun>();
  if (noms.length === 0) return mapa;

  // Una consulta per nom: la taula és petita i evitem DISTINCT ON específic
  // de Postgres amb sintaxi fràgil a Drizzle.
  await Promise.all(
    noms.map(async (nom) => {
      const [fila] = await db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.jobName, nom), isNull(jobRuns.parentId)))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      if (fila) mapa.set(nom, fila);
    }),
  );
  return mapa;
}

export interface ResumSalut {
  enCurs: number;
  fallades24h: number;
  darreraPassadaDiaria: JobRun | null;
}

export async function resumSalut(): Promise<ResumSalut> {
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
export async function syncRunsDeLExecucio(execucio: JobRun): Promise<SyncRun[]> {
  if (execucio.jobName !== "sync") return [];
  const inici = execucio.startedAt;
  const fi = execucio.finishedAt ?? new Date();
  // Una mica de marge: la feina comença abans d'obrir el primer sync_run.
  const desDe = new Date(inici.getTime() - 5_000);
  const fins = new Date(fi.getTime() + 5_000);
  return db
    .select()
    .from(syncRuns)
    .where(and(gte(syncRuns.startedAt, desDe), lte(syncRuns.startedAt, fins)))
    .orderBy(asc(syncRuns.startedAt));
}

/** Marca com a fallides les feines `running` de més de 2 h. */
export async function tancaFeinesPenjades(): Promise<number> {
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
