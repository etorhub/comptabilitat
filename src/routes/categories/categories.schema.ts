/**
 * Category schemas.
 *
 * They are derived from the Drizzle table with `drizzle-zod` and then
 * refined: the table is the source of truth and this comes out of it, not the
 * other way round.
 */

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { categories, categoryKindSchema } from "../../db/schema/index.ts";

/** An integer coming from a form field, where empty means «none». */
const optionalId = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const base = createInsertSchema(categories, {
  name: (s) => s.trim().min(1, "Cal un nom").max(120, "El nom es massa llarg"),
  color: (s) =>
    s.regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color ha de ser un codi hexadecimal"),
});

/**
 * Creation. `kind` is only used when there is no parent: a subcategory always
 * inherits the parent's type, as the Python did.
 */
export const categoryCreateSchema = base.pick({ name: true }).extend({
  kind: categoryKindSchema,
  parent_id: optionalId,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color ha de ser un codi hexadecimal")
    .default("#94a3b8"),
  icon: z.string().max(40).default(""),
});

/** Rename from the table row. */
export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1, "Cal un nom").max(120, "El nom es massa llarg"),
});

export const categoryDeleteSchema = z.object({
  /** Where any transactions it has should go. */
  reassign_to: optionalId,
});
