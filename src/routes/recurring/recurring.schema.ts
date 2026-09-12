/**
 * Schemas of the recurring series (schedules).
 *
 * The detector only proposes; from here they are confirmed, dismissed,
 * created by hand, or their amount edited. The forecast only looks at the
 * active ones with `include_in_forecast`.
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

export const confirmSeriesSchema = z.object({
  cadence: cadenceSchema,
  amount_mode: amountModeSchema,
});

const importSchema = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d{1,2})?$/, "L'import no es valid")
  .transform((v) => toMoneyString(v.replace(",", ".")));

export const createSeriesSchema = z.object({
  label: z.string().trim().min(1, "Cal un nom").max(200),
  category_id: z.coerce.number().int().positive("Cal una categoria"),
  cadence: cadenceSchema,
  /** Absolute value; the direction is given by `sentit`. */
  amount: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, "L'import no es valid")
    .transform((v) => toMoneyString(v.replace(",", "."))),
  sentit: z.enum(["out", "in"]),
  next_expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La data ha de ser AAAA-MM-DD"),
});

export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

export const updateAmountSchema = z.object({
  amount: importSchema,
});
