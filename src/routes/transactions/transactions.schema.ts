/**
 * Esquemes dels moviments.
 */

import { z } from "zod/v4";

export const PER_PAGINA = 50;

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La data ha de ser AAAA-MM-DD")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const casella = z
  .union([z.literal("1"), z.literal("on"), z.literal("true")])
  .optional()
  .transform((v) => v !== undefined);

export const transactionFiltersSchema = z.object({
  cerca: z.string().trim().max(200).default(""),
  des: data,
  fins: data,
  compte: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  categoria: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  etiqueta: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  sense_classificar: casella,
  revisio: casella,
  traspassos: casella,
  pagina: z.coerce.number().int().min(0).default(0),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

/** Hi ha cap filtre de cerca actiu (la pagina no compta). */
export function teFiltresActius(f: TransactionFilters): boolean {
  return Boolean(
    f.cerca ||
      f.des ||
      f.fins ||
      f.compte !== null ||
      f.categoria !== null ||
      f.etiqueta ||
      f.sense_classificar ||
      f.revisio ||
      f.traspassos,
  );
}

export function transactionFiltersToQuery(f: TransactionFilters): string {
  const p = new URLSearchParams();
  if (f.cerca) p.set("cerca", f.cerca);
  if (f.des) p.set("des", f.des);
  if (f.fins) p.set("fins", f.fins);
  if (f.compte !== null) p.set("compte", String(f.compte));
  if (f.categoria !== null) p.set("categoria", String(f.categoria));
  if (f.etiqueta) p.set("etiqueta", f.etiqueta);
  if (f.sense_classificar) p.set("sense_classificar", "1");
  if (f.revisio) p.set("revisio", "1");
  if (f.traspassos) p.set("traspassos", "1");
  if (f.pagina > 0) p.set("pagina", String(f.pagina));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Canvi de categoria d'un moviment des de la fila. */
export const categorizeSchema = z.object({
  category_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  /** Si tambe s'ha de recordar per a tot el comerç. */
  recorda_comerc: z
    .union([z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === undefined),
  /** Si a mes n'ha de sortir una regla. */
  crea_regla: z
    .union([z.literal("on"), z.literal("1"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

/** Classificacio en bloc: les caselles marcades de la taula. */
export const bulkCategorizeSchema = z.object({
  moviment: z.union([z.string(), z.array(z.string())]).transform((v, ctx) => {
    const bruts = Array.isArray(v) ? v : [v];
    const ids = bruts
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      ctx.addIssue({ code: "custom", message: "No hi ha cap moviment triat" });
    }
    return ids;
  }),
  category_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  recorda_comerc: z
    .union([z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === undefined),
});

/** Alta o baixa d'una etiqueta des de la fila. */
export const tagMutationSchema = z.object({
  etiqueta: z
    .string({ error: "Cal un nom d'etiqueta" })
    .trim()
    .min(1, "Cal un nom d'etiqueta")
    .max(40, "L'etiqueta pot tenir com a molt 40 caracters")
    .refine((v) => !v.includes(","), "L'etiqueta no pot dur comes")
    .transform((v) => v.replace(/\s+/g, " ")),
});

/** Alta d'etiqueta des del formulari de fila (camp amb nom propi). */
export const tagAddRowSchema = z.object({
  nova_etiqueta: z
    .string({ error: "Cal un nom d'etiqueta" })
    .trim()
    .min(1, "Cal un nom d'etiqueta")
    .max(40, "L'etiqueta pot tenir com a molt 40 caracters")
    .refine((v) => !v.includes(","), "L'etiqueta no pot dur comes")
    .transform((v) => v.replace(/\s+/g, " ")),
});

/** Etiqueta en bloc: caselles + camp de la barra. */
export const bulkTagSchema = z.object({
  moviment: z.union([z.string(), z.array(z.string())]).transform((v, ctx) => {
    const bruts = Array.isArray(v) ? v : [v];
    const ids = bruts
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      ctx.addIssue({ code: "custom", message: "No hi ha cap moviment triat" });
    }
    return ids;
  }),
  etiqueta_bloc: z
    .string({ error: "Cal un nom d'etiqueta" })
    .trim()
    .min(1, "Cal un nom d'etiqueta")
    .max(40, "L'etiqueta pot tenir com a molt 40 caracters")
    .refine((v) => !v.includes(","), "L'etiqueta no pot dur comes")
    .transform((v) => v.replace(/\s+/g, " ")),
});

/** L'alias que amaga el concepte del banc. Buidar-lo el torna a ensenyar. */
export const maskSchema = z.object({
  display_description: z
    .string()
    .trim()
    .max(200, "Com a molt 200 carácters")
    .transform((v) => (v === "" ? null : v)),
});

export const notesSchema = z.object({
  notes: z.string().trim().max(2000, "Les notes son massa llargues"),
});
