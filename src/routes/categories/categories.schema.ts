/**
 * Esquemes de les categories.
 *
 * Es deriven de la taula de Drizzle amb `drizzle-zod` i despres es refinen:
 * la taula es la font de veritat i aixo en surt, no al reves.
 */

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { categories, categoryKindSchema } from "../../db/schema/index.ts";

/** Un enter que ve d'un camp de formulari, on el buit vol dir «cap». */
const idOpcional = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** Les caselles arriben com a "on" quan estan marcades, i no arriben quan no. */
const casella = z
  .union([z.literal("on"), z.literal("1"), z.literal("true")])
  .optional()
  .transform((v) => v !== undefined);

const base = createInsertSchema(categories, {
  name: (s) => s.trim().min(1, "Cal un nom").max(120, "El nom es massa llarg"),
  color: (s) =>
    s.regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color ha de ser un codi hexadecimal"),
});

/**
 * Alta. `kind` nomes es fa servir quan no hi ha pare: una subcategoria hereta
 * sempre el tipus del pare, com feia el Python.
 */
export const categoryCreateSchema = base.pick({ name: true }).extend({
  kind: categoryKindSchema,
  parent_id: idOpcional,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color ha de ser un codi hexadecimal")
    .default("#94a3b8"),
  icon: z.string().max(40).default(""),
  is_subscription: casella,
});

/** Canvi de nom i de marca de subscripcio des de la fila de la taula. */
export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1, "Cal un nom").max(120, "El nom es massa llarg"),
});

export const categoryDeleteSchema = z.object({
  /** A qui van a parar els moviments que hi hagi. */
  reassign_to: idOpcional,
});
