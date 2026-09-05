/**
 * Esquemes dels comerços.
 *
 * Els comerços no es creen des de la interficie: els crea la sincronitzacio a
 * mesura que apareixen. Des d'aqui nomes se'n canvia el nom que es veu i la
 * categoria per defecte.
 */

import { z } from "zod/v4";

import { cadenceSchema } from "../../db/schema/index.ts";

export const PER_PAGINA = 50;

export const merchantFiltersSchema = z.object({
  cerca: z.string().trim().max(200).default(""),
  sense_classificar: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
  sense_confirmar: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
  pagina: z.coerce.number().int().min(0).default(0),
});

export type MerchantFilters = z.infer<typeof merchantFiltersSchema>;

/** Reconstrueix la cadena de consulta canonica, per a `HX-Push-Url`. */
export function merchantFiltersToQuery(f: MerchantFilters): string {
  const p = new URLSearchParams();
  if (f.cerca) p.set("cerca", f.cerca);
  if (f.sense_classificar) p.set("sense_classificar", "1");
  if (f.sense_confirmar) p.set("sense_confirmar", "1");
  if (f.pagina > 0) p.set("pagina", String(f.pagina));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Canvi de la categoria per defecte des de la fila de la taula. */
export const merchantCategorySchema = z.object({
  default_category_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  /** Si tambe s'ha d'aplicar als moviments que ja hi ha. */
  aplica_existents: z
    .union([z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === undefined),
});

/**
 * Marcar el comerç com a recurrent. La casella desmarcada no arriba al cos;
 * la cadencia nomes cal quan es marca (si falta, el servei fa servir monthly).
 */
export const merchantRecurrentSchema = z.object({
  is_recurrent: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
  recurrent_cadence: cadenceSchema.optional(),
});
