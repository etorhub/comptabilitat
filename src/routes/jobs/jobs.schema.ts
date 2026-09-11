/**
 * Esquemes de les feines manuals i del seu historial.
 */

import { z } from "zod/v4";

import { JOB_STATUSES, JOB_TRIGGERS } from "../../db/schema/enums.ts";

export const FEINES = [
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

export type FeinaId = (typeof FEINES)[number];

export const feinaSchema = z.object({
  feina: z.enum(FEINES),
});

/** Etiquetes curtes per a la UI. */
export const ETIQUETES_FEINA: Record<FeinaId, string> = {
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

export const ETIQUETES_ORIGEN: Record<(typeof JOB_TRIGGERS)[number], string> = {
  scheduled: "Cron",
  manual: "UI",
  cli: "CLI",
};

export const ETIQUETES_ESTAT: Record<(typeof JOB_STATUSES)[number], string> = {
  running: "En curs",
  success: "Fet",
  partial: "Parcial",
  failed: "Ha fallat",
};

/** Passades que contenen cada feina individual (per deshabilitar el boto). */
export const PASSADES_QUE_CONTENEN: Partial<Record<FeinaId, readonly FeinaId[]>> = {
  sync: ["passada-diaria", "totes"],
  classify: ["passada-diaria", "passada-nocturna", "totes"],
  llm: ["passada-nocturna", "totes"],
  analyze: ["passada-diaria", "totes"],
  notify: ["totes"],
  maintenance: ["totes"],
  "passada-diaria": ["totes"],
  "passada-nocturna": ["totes"],
};

const buitAUndef = <T extends z.ZodType>(esquema: T) =>
  z
    .union([esquema, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const historialFiltersSchema = z.object({
  feina: buitAUndef(z.enum(FEINES)),
  estat: buitAUndef(z.enum(JOB_STATUSES)),
  origen: buitAUndef(z.enum(JOB_TRIGGERS)),
  des_de: data,
  fins_a: data,
  pagina: z.coerce.number().int().min(0).default(0),
});

export type HistorialFilters = z.infer<typeof historialFiltersSchema>;

export function historialFiltersToQuery(filters: HistorialFilters): string {
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

/** Converteix les dates de calendari dels filtres a instants. */
export function filtresAServei(filters: HistorialFilters) {
  return {
    feina: filters.feina,
    estat: filters.estat,
    origen: filters.origen,
    desDe: filters.des_de ? new Date(`${filters.des_de}T00:00:00`) : undefined,
    finsA: filters.fins_a ? new Date(`${filters.fins_a}T23:59:59.999`) : undefined,
    pagina: filters.pagina,
    limit: 30,
  };
}
