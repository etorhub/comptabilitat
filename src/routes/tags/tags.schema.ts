/**
 * Schemas of the tags resource.
 */

import { z } from "zod/v4";

export const PER_PAGE = 50;

export const tagDetailQuerySchema = z.object({
  pagina: z.coerce.number().int().min(0).default(0),
});

export type TagDetailQuery = z.infer<typeof tagDetailQuerySchema>;

export function tagDetailToQuery(q: TagDetailQuery): string {
  if (q.pagina <= 0) return "";
  return `?pagina=${q.pagina}`;
}

/** Tag name in the URL (after decodeURIComponent). */
export function nameFromRoute(value: string | undefined): string {
  const brut = value ?? "";
  let decodificat = brut;
  try {
    decodificat = decodeURIComponent(brut);
  } catch {
    decodificat = brut;
  }
  return decodificat.trim().replace(/\s+/g, " ");
}
