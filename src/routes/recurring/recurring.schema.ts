/**
 * Esquemes de les series recurrents.
 *
 * Les series no les crea ningu a ma: les detecta la feina programada a partir
 * de l'historic. Des d'aqui nomes se'n canvien tres coses.
 */

import { z } from "zod/v4";

export const recurringFiltersSchema = z.object({
  nomes_subscripcions: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
  inclou_acabades: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

export type RecurringFilters = z.infer<typeof recurringFiltersSchema>;

export function recurringFiltersToQuery(f: RecurringFilters): string {
  const p = new URLSearchParams();
  if (f.nomes_subscripcions) p.set("nomes_subscripcions", "1");
  if (f.inclou_acabades) p.set("inclou_acabades", "1");
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Canvi de l'etiqueta d'una serie. */
export const recurringRenameSchema = z.object({
  label: z.string().trim().min(1, "Cal un nom").max(200, "El nom es massa llarg"),
});
