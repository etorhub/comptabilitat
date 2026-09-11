/**
 * Esquemes de les series recurrents (schedules).
 *
 * El detector nomes proposa; des d'aqui es confirmen, descarten, creen a ma
 * o s'edita l'import. La previsio nomes mira les actives amb
 * `include_in_forecast`.
 */

import { z } from "zod/v4";

import { amountModeSchema, cadenceSchema } from "../../db/schema/enums.ts";
import { toMoneyString } from "../../lib/money.ts";

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

const importSchema = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d{1,2})?$/, "L'import no es valid")
  .transform((v) => toMoneyString(v.replace(",", ".")));

export const creaSerieSchema = z.object({
  label: z.string().trim().min(1, "Cal un nom").max(200),
  category_id: z.coerce.number().int().positive("Cal una categoria"),
  cadence: cadenceSchema,
  /** Valor absolut; el sentit el marca `sentit`. */
  amount: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, "L'import no es valid")
    .transform((v) => toMoneyString(v.replace(",", "."))),
  sentit: z.enum(["out", "in"]),
  next_expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La data ha de ser AAAA-MM-DD"),
});

export type CreaSerieInput = z.infer<typeof creaSerieSchema>;

export const actualitzaImportSchema = z.object({
  amount: importSchema,
});
