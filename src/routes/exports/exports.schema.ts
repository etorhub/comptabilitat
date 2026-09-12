/**
 * Download schemas.
 *
 * They reuse the transaction filters: what you download is what you are
 * looking at.
 */

import { z } from "zod/v4";

/** Row ceiling per download, like the Python's `MAX_ROWS`. */
export const MAX_ROWS = 20_000;

export const exportFiltersSchema = z.object({
  search: z.string().trim().max(200).default(""),
  des: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  category: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  transfers: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

export const summarySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
});
