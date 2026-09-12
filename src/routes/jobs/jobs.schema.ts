/**
 * Schemas for the manual jobs and their history.
 */

import { z } from "zod/v4";

import { JOB_STATUSES, JOB_TRIGGERS } from "../../db/schema/enums.ts";

export const JOBS = [
  "passada-diaria",
  "passada-nocturna",
  "sync",
  "classify",
  "llm",
  "analyze",
  "notify",
  "notify-urgents",
  "maintenance",
  "totes",
] as const;

export type JobId = (typeof JOBS)[number];

export const jobSchema = z.object({
  job: z.enum(JOBS),
});

/** Short labels for the UI. */
export const JOB_LABELS: Record<JobId, string> = {
  "passada-diaria": "Passada diaria",
  "passada-nocturna": "Passada nocturna",
  sync: "Sincronitzacio",
  classify: "Classificacio",
  llm: "Model local",
  analyze: "Analisi",
  notify: "Avisos",
  "notify-urgents": "Avisos urgents",
  maintenance: "Manteniment",
  totes: "Totes les feines",
};

export const TRIGGER_LABELS: Record<(typeof JOB_TRIGGERS)[number], string> = {
  scheduled: "Cron",
  manual: "UI",
  cli: "CLI",
};

export const STATUS_LABELS: Record<(typeof JOB_STATUSES)[number], string> = {
  running: "En curs",
  success: "Fet",
  partial: "Parcial",
  failed: "Ha fallat",
};

/** Passes that contain each individual job (to disable the button). */
export const PASSES_CONTAINING: Partial<Record<JobId, readonly JobId[]>> = {
  sync: ["passada-diaria", "totes"],
  classify: ["passada-diaria", "passada-nocturna", "totes"],
  llm: ["passada-nocturna", "totes"],
  analyze: ["passada-diaria", "totes"],
  notify: ["totes"],
  maintenance: ["totes"],
  "passada-diaria": ["totes"],
  "passada-nocturna": ["totes"],
};

const emptyToUndef = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const historyFiltersSchema = z.object({
  feina: emptyToUndef(z.enum(JOBS)),
  estat: emptyToUndef(z.enum(JOB_STATUSES)),
  origen: emptyToUndef(z.enum(JOB_TRIGGERS)),
  des_de: date,
  fins_a: date,
  pagina: z.coerce.number().int().min(0).default(0),
});

export type HistoryFilters = z.infer<typeof historyFiltersSchema>;

export function historyFiltersToQuery(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.feina) params.set("feina", filters.feina);
  if (filters.estat) params.set("estat", filters.estat);
  if (filters.origen) params.set("origen", filters.origen);
  if (filters.des_de) params.set("des_de", filters.des_de);
  if (filters.fins_a) params.set("fins_a", filters.fins_a);
  if (filters.pagina > 0) params.set("pagina", String(filters.pagina));
  const q = params.toString();
  return q ? `?${q}` : "";
}

/** Converts the filters' calendar dates to instants. */
export function filtersToService(filters: HistoryFilters) {
  return {
    job: filters.feina,
    state: filters.estat,
    origin: filters.origen,
    from: filters.des_de ? new Date(`${filters.des_de}T00:00:00`) : undefined,
    until: filters.fins_a ? new Date(`${filters.fins_a}T23:59:59.999`) : undefined,
    page: filters.pagina,
    limit: 30,
  };
}
