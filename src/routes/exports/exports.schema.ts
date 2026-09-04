/**
 * Esquemes de les descarregues.
 *
 * Reutilitzen els filtres dels moviments: el que et descarregues es el que
 * estas veient.
 */

import { z } from "zod/v4";

/** Sostre de files per descarrega, com el `MAX_ROWS` del Python. */
export const MAX_FILES = 20_000;

export const exportFiltersSchema = z.object({
  cerca: z.string().trim().max(200).default(""),
  des: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  fins: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  categoria: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  traspassos: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

export const summarySchema = z.object({
  mesos: z.coerce.number().int().min(1).max(60).default(12),
});
