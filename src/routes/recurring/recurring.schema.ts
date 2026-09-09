/**
 * Esquemes de les series recurrents (schedules).
 *
 * El detector nomes proposa; des d'aqui es confirmen, descarten o s'inclouen
 * a la previsio.
 */

import { z } from "zod/v4";

import { amountModeSchema, cadenceSchema } from "../../db/schema/enums.ts";

export const recurringFiltersSchema = z.object({
  inclou_acabades: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

export type RecurringFilters = z.infer<typeof recurringFiltersSchema>;

export function recurringFiltersToQuery(f: RecurringFilters): string {
  const p = new URLSearchParams();
  if (f.inclou_acabades) p.set("inclou_acabades", "1");
  const q = p.toString();
  return q ? `?${q}` : "";
}

export const confirmaSerieSchema = z.object({
  cadence: cadenceSchema,
  amount_mode: amountModeSchema,
});
