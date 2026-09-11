/**
 * Esquemes dels moviments.
 */

import { z } from "zod/v4";

import { TIPUS_OPERACIO, type TipusOperacio } from "../../services/concepte.ts";

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

const tipusSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): TipusOperacio[] => {
    const bruts = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const valids = new Set<TipusOperacio>(TIPUS_OPERACIO);
    return [
      ...new Set(bruts.filter((x): x is TipusOperacio => valids.has(x as TipusOperacio))),
    ];
  });

const targetaSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    const bruts = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return [...new Set(bruts.filter((x) => /^\d{4}$/.test(x)))];
  });

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
  tipus: tipusSchema,
  targeta: targetaSchema,
  sense_classificar: casella,
  revisio: casella,
  traspassos: casella,
  pagina: z.coerce.number().int().min(0).default(0),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

/** Etiquetes catalanes per a la barra de filtres. */
export const ETIQUETES_TIPUS: { valor: TipusOperacio; text: string }[] = [
  { valor: "targeta", text: "Targeta" },
  { valor: "transferencia", text: "Transferència" },
  { valor: "bizum", text: "Bizum" },
  { valor: "rebut", text: "Rebut" },
  { valor: "altres", text: "Altres" },
];

/** Hi ha cap filtre de cerca actiu (la pagina no compta). */
export function teFiltresActius(f: TransactionFilters): boolean {
  return Boolean(
    f.cerca ||
    f.des ||
    f.fins ||
    f.compte !== null ||
    f.categoria !== null ||
    f.etiqueta ||
    f.tipus.length > 0 ||
    f.targeta.length > 0 ||
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
  for (const t of f.tipus) p.append("tipus", t);
  for (const t of f.targeta) p.append("targeta", t);
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
