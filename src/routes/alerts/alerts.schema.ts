/**
 * Esquemes dels avisos.
 *
 * Els avisos no els crea ningu des de la interficie: els generen les feines
 * programades (descobert previst, consentiment a punt de caducar, rebut que no
 * ha arribat...). Des d'aqui nomes es poden llegir i descartar, i per aixo
 * l'unic que cal validar son els filtres de la llista.
 */

import { z } from "zod";

export const alertFiltersSchema = z.object({
  /** Per defecte els descartats no es veuen: descartar-ne un vol dir «fora». */
  descartats: z
    .union([z.literal("1"), z.literal("true"), z.literal("on")])
    .optional()
    .transform((v) => v !== undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AlertFilters = z.infer<typeof alertFiltersSchema>;

/** Reconstrueix la cadena de consulta canonica, per a `HX-Push-Url`. */
export function alertFiltersToQuery(filters: AlertFilters): string {
  const params = new URLSearchParams();
  if (filters.descartats) params.set("descartats", "1");
  if (filters.limit !== 50) params.set("limit", String(filters.limit));
  const q = params.toString();
  return q ? `?${q}` : "";
}
