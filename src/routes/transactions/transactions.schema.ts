/**
 * Transaction schemas.
 */

import { z } from "zod/v4";

import { OPERATION_TYPES, type OperationType } from "../../services/concept.ts";

export const PER_PAGE = 50;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La data ha de ser AAAA-MM-DD")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const checkbox = z
  .union([z.literal("1"), z.literal("on"), z.literal("true")])
  .optional()
  .transform((v) => v !== undefined);

const typeSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): OperationType[] => {
    const bruts = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const valids = new Set<OperationType>(OPERATION_TYPES);
    return [
      ...new Set(bruts.filter((x): x is OperationType => valids.has(x as OperationType))),
    ];
  });

const cardSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    const bruts = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return [...new Set(bruts.filter((x) => /^\d{4}$/.test(x)))];
  });

export const transactionFiltersSchema = z.object({
  cerca: z.string().trim().max(200).default(""),
  des: date,
  to: date,
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
  type: typeSchema,
  card: cardSchema,
  sense_classificar: checkbox,
  revisio: checkbox,
  traspassos: checkbox,
  pagina: z.coerce.number().int().min(0).default(0),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

/** Catalan labels for the filter bar. */
export const OPERATION_TYPE_LABELS: { value: OperationType; text: string }[] = [
  { value: "targeta", text: "Targeta" },
  { value: "transferencia", text: "Transferència" },
  { value: "bizum", text: "Bizum" },
  { value: "rebut", text: "Rebut" },
  { value: "altres", text: "Altres" },
];

/** Whether any search filter is active (the page number does not count). */
export function hasActiveFilters(f: TransactionFilters): boolean {
  return Boolean(
    f.cerca ||
    f.des ||
    f.to ||
    f.compte !== null ||
    f.categoria !== null ||
    f.etiqueta ||
    f.type.length > 0 ||
    f.card.length > 0 ||
    f.sense_classificar ||
    f.revisio ||
    f.traspassos,
  );
}

export function transactionFiltersToQuery(f: TransactionFilters): string {
  const p = new URLSearchParams();
  if (f.cerca) p.set("cerca", f.cerca);
  if (f.des) p.set("des", f.des);
  if (f.to) p.set("fins", f.to);
  if (f.compte !== null) p.set("compte", String(f.compte));
  if (f.categoria !== null) p.set("categoria", String(f.categoria));
  if (f.etiqueta) p.set("etiqueta", f.etiqueta);
  for (const t of f.type) p.append("tipus", t);
  for (const t of f.card) p.append("targeta", t);
  if (f.sense_classificar) p.set("sense_classificar", "1");
  if (f.revisio) p.set("revisio", "1");
  if (f.traspassos) p.set("traspassos", "1");
  if (f.pagina > 0) p.set("pagina", String(f.pagina));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Category change of a transaction from the row. */
export const categorizeSchema = z.object({
  category_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  /** Whether it should also be remembered for the whole merchant. */
  recorda_comerc: z
    .union([z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === undefined),
});

/** Bulk classification: the ticked checkboxes of the table. */
export const bulkCategorizeSchema = z.object({
  transaction: z.union([z.string(), z.array(z.string())]).transform((v, ctx) => {
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

/** Adding or removing a tag from the row. */
export const tagMutationSchema = z.object({
  tag: z
    .string({ error: "Cal un nom d'etiqueta" })
    .trim()
    .min(1, "Cal un nom d'etiqueta")
    .max(40, "L'etiqueta pot tenir com a molt 40 caracters")
    .refine((v) => !v.includes(","), "L'etiqueta no pot dur comes")
    .transform((v) => v.replace(/\s+/g, " ")),
});

/** Adding a tag from the row form (field with its own name). */
export const tagAddRowSchema = z.object({
  nova_etiqueta: z
    .string({ error: "Cal un nom d'etiqueta" })
    .trim()
    .min(1, "Cal un nom d'etiqueta")
    .max(40, "L'etiqueta pot tenir com a molt 40 caracters")
    .refine((v) => !v.includes(","), "L'etiqueta no pot dur comes")
    .transform((v) => v.replace(/\s+/g, " ")),
});

/** Bulk tag: checkboxes + the bar's field. */
export const bulkTagSchema = z.object({
  transaction: z.union([z.string(), z.array(z.string())]).transform((v, ctx) => {
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

/** The alias that hides the bank's concept. Clearing it shows it again. */
export const maskSchema = z.object({
  display_description: z
    .string()
    .trim()
    .max(200, "Com a molt 200 carácters")
    .transform((v) => (v === "" ? null : v)),
});
