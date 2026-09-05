/**
 * Esquemes dels actors.
 *
 * Els actors no es creen des de la interficie: els crea el repartiment de
 * contraparts (`services/contraparts.ts`) quan un moviment es una
 * transferencia. Des d'aqui nomes es confirmen (mena i nom), es lliguen a un
 * usuari o es fusionen.
 */

import { z } from "zod/v4";

import { actorKindSchema } from "../../db/schema/index.ts";

export const PER_PAGINA = 50;

export const actorFiltersSchema = z.object({
  cerca: z.string().trim().max(200).default(""),
  sense_confirmar: z
    .union([z.literal("1"), z.literal("on"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
  pagina: z.coerce.number().int().min(0).default(0),
});

export type ActorFilters = z.infer<typeof actorFiltersSchema>;

/** Reconstrueix la cadena de consulta canonica, per a `HX-Push-Url`. */
export function actorFiltersToQuery(f: ActorFilters): string {
  const p = new URLSearchParams();
  if (f.cerca) p.set("cerca", f.cerca);
  if (f.sense_confirmar) p.set("sense_confirmar", "1");
  if (f.pagina > 0) p.set("pagina", String(f.pagina));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Confirmar la mena i el nom d'un actor. */
export const actorConfirmSchema = z.object({
  kind: actorKindSchema,
  display_name: z.string().trim().min(1, "Cal un nom").max(200, "El nom es massa llarg"),
});

/** Lligar (o desenllaçar, amb el buit) un actor a un usuari de l'app. */
export const actorUserSchema = z.object({
  user_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

/** Fusionar-hi un altre actor de l'espai. */
export const actorMergeSchema = z.object({
  altre_id: z.coerce.number().int().positive(),
});
