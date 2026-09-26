/**
 * What the chat's model said, made safe to act on.
 *
 * The model answers with JSON that Ollama already constrains to a schema, but a
 * small model still gets things wrong: numbers as text, a period it made up, a
 * date that is not a date. Everything here is tolerant on the way in and strict
 * on the way out: a value that does not validate is dropped, never guessed.
 *
 * Nothing here touches the database, so it is tested in `tests/unit/`.
 */

import { z } from "zod/v4";

import { CHAT_INTENTS, CHAT_PERIODS } from "../lib/ollama/chat-prompts.ts";
import { Decimal } from "../lib/money.ts";
import { addDays } from "../lib/time.ts";

export type PeriodKind = (typeof CHAT_PERIODS)[number];
export type Direction = "expense" | "income" | "any";

const EDIT_KINDS = [
  "recategorize",
  "merchant_rule",
  "tag_add",
  "tag_remove",
  "note_set",
] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

/** A string the model wrote: trimmed, bounded, and absent when empty. */
const words = (max: number) =>
  z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " ").slice(0, max))
    .optional()
    .catch(undefined);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
  .optional()
  .catch(undefined);

const year = z.coerce.number().int().min(1990).max(2100).optional().catch(undefined);

/** Euros, positive. Kept as a `Decimal`-parsable string, never as a float to compute with. */
const amount = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const text = String(v).trim().replace(",", ".").replace(/^-/, "");
    if (!/^\d+(\.\d+)?$/.test(text)) {
      ctx.addIssue({ code: "custom", message: "not an amount" });
      return z.NEVER;
    }
    return new Decimal(text).toFixed(2);
  })
  .optional()
  .catch(undefined);

/** The model's answer, validated. This is what is stored and fed back as context. */
export const modelAnswerSchema = z.object({
  intent: z.enum(CHAT_INTENTS).catch("unknown"),
  text: words(100),
  merchant: words(100),
  category: words(100),
  account: words(100),
  direction: z.enum(["expense", "income", "any"]).optional().catch(undefined),
  period: z.enum(CHAT_PERIODS).optional().catch(undefined),
  year,
  date_from: isoDate,
  date_to: isoDate,
  compare_period: z.enum(CHAT_PERIODS).optional().catch(undefined),
  compare_year: year,
  amount_min: amount,
  amount_max: amount,
  group_by: z.enum(["category", "merchant"]).optional().catch(undefined),
  order_by: z.enum(["date", "amount"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).optional().catch(undefined),
  target_category: words(100),
  remember: z.boolean().optional().catch(undefined),
  tag: words(40),
  note: words(500),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

/** Parses whatever came back. `null` when it is not even an object. */
export function readModelAnswer(raw: unknown): ModelAnswer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const parsed = modelAnswerSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Drop the keys that came back undefined, so what is stored is only what was said.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== ""),
  ) as ModelAnswer;
}

// --- Periods ---------------------------------------------------------------

export interface PeriodSpec {
  kind: PeriodKind;
  year?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface DateRange {
  /** Inclusive. Null = no bound. */
  from: string | null;
  to: string | null;
  /** Always shown with the answer, so a misunderstanding can be caught. */
  label: string;
}

/** «26/09/2025», because this goes on screen. */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The same calendar day `months` months away, clamped to the end of the month. */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const nd = Math.min(d, lastDayOfMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

function range(from: string | null, to: string | null): DateRange {
  if (from === null && to === null) return { from, to, label: "tot l'historial" };
  if (from === null && to !== null) return { from, to, label: `fins al ${shortDate(to)}` };
  if (from !== null && to === null) return { from, to, label: `des del ${shortDate(from)}` };
  return { from, to, label: `del ${shortDate(from ?? "")} al ${shortDate(to ?? "")}` };
}

/**
 * Turns a period word into dates.
 *
 * «El darrer any» is the last twelve months up to today; «l'any passat» is the
 * whole previous calendar year. That choice is made here and nowhere else, and
 * the label says which dates were used.
 */
export function resolvePeriod(spec: PeriodSpec, today: string): DateRange {
  const y = Number(today.slice(0, 4));
  switch (spec.kind) {
    case "all":
      return range(null, null);
    case "this_month":
      return range(`${today.slice(0, 7)}-01`, today);
    case "last_month": {
      const first = addMonths(`${today.slice(0, 7)}-01`, -1);
      return range(first, addDays(`${today.slice(0, 7)}-01`, -1));
    }
    case "last_30_days":
      return range(addDays(today, -29), today);
    case "last_3_months":
      return range(addMonths(today, -3), today);
    case "last_12_months":
      return range(addMonths(today, -12), today);
    case "this_year":
      return range(`${y}-01-01`, today);
    case "last_year":
      return range(`${y - 1}-01-01`, `${y - 1}-12-31`);
    case "year": {
      if (spec.year === undefined) return range(null, null);
      return range(`${spec.year}-01-01`, `${spec.year}-12-31`);
    }
    case "custom": {
      let from = spec.from ?? null;
      let to = spec.to ?? null;
      if (from !== null && to !== null && from > to) [from, to] = [to, from];
      return range(from, to);
    }
  }
}

/** The period of the same length just before this one, for a comparison. */
export function previousRange(current: DateRange): DateRange | null {
  if (current.from === null || current.to === null) return null;
  const from = current.from;
  const to = current.to;
  // A calendar year, or its first months, compares with the same stretch of the year before.
  if (from.endsWith("-01-01") && to.slice(0, 4) === from.slice(0, 4)) {
    const y = Number(from.slice(0, 4)) - 1;
    const end = to.endsWith("-12-31") ? `${y}-12-31` : `${y}${to.slice(4)}`;
    return range(`${y}-01-01`, end);
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  const newTo = addDays(from, -1);
  return range(addDays(newTo, -days), newTo);
}

// --- The normalised intent -------------------------------------------------

/** The filters as the model named them. The names are resolved against the database later. */
export interface NamedFilter {
  text: string;
  merchant: string;
  category: string;
  account: string;
  direction: Direction;
  period: PeriodSpec;
  amountMin: string | null;
  amountMax: string | null;
}

export type Intent =
  | { kind: "total"; filter: NamedFilter }
  | { kind: "list"; filter: NamedFilter; orderBy: "date" | "amount"; limit: number }
  | { kind: "breakdown"; filter: NamedFilter; groupBy: "category" | "merchant"; limit: number }
  | { kind: "series"; filter: NamedFilter }
  | { kind: "compare"; filter: NamedFilter; other: PeriodSpec | null }
  | { kind: "recategorize"; filter: NamedFilter; targetCategory: string; remember: boolean }
  | { kind: "merchant_rule"; filter: NamedFilter; targetCategory: string }
  | { kind: "tag_add" | "tag_remove"; filter: NamedFilter; tag: string }
  | { kind: "note_set"; filter: NamedFilter; note: string }
  | { kind: "unknown" };

function periodOf(
  kind: PeriodKind | undefined,
  y: number | undefined,
  from?: string,
  to?: string,
): PeriodSpec {
  if (kind === "custom" && from === undefined && to === undefined) return { kind: "all" };
  if (kind === "year" && y === undefined) return { kind: "all" };
  if (kind === undefined && y !== undefined) return { kind: "year", year: y };
  if (kind === undefined && (from !== undefined || to !== undefined)) {
    return { kind: "custom", from, to };
  }
  return { kind: kind ?? "all", year: y, from, to };
}

/** From the model's flat answer to something each branch can use without checking again. */
export function toIntent(answer: ModelAnswer): Intent {
  const filter: NamedFilter = {
    text: answer.text ?? "",
    merchant: answer.merchant ?? "",
    category: answer.category ?? "",
    account: answer.account ?? "",
    direction: answer.direction ?? "any",
    period: periodOf(answer.period, answer.year, answer.date_from, answer.date_to),
    amountMin: answer.amount_min ?? null,
    amountMax: answer.amount_max ?? null,
  };

  switch (answer.intent) {
    case "total":
    case "series":
      return { kind: answer.intent, filter };
    case "list":
      return {
        kind: "list",
        filter,
        orderBy: answer.order_by ?? "date",
        limit: answer.limit ?? 20,
      };
    case "breakdown":
      return {
        kind: "breakdown",
        filter,
        groupBy: answer.group_by ?? "category",
        limit: answer.limit ?? 10,
      };
    case "compare": {
      const other =
        answer.compare_period === undefined && answer.compare_year === undefined
          ? null
          : periodOf(answer.compare_period, answer.compare_year);
      return { kind: "compare", filter, other };
    }
    case "recategorize":
      return {
        kind: "recategorize",
        filter,
        targetCategory: answer.target_category ?? "",
        remember: answer.remember ?? false,
      };
    case "merchant_rule":
      return {
        kind: "merchant_rule",
        // The model sometimes puts the merchant in `text`: either will do here.
        filter: { ...filter, merchant: filter.merchant || filter.text, text: "" },
        targetCategory: answer.target_category ?? "",
      };
    case "tag_add":
    case "tag_remove":
      return { kind: answer.intent, filter, tag: answer.tag ?? "" };
    case "note_set":
      return { kind: "note_set", filter, note: answer.note ?? "" };
    case "unknown":
      return { kind: "unknown" };
  }
}

export type EditIntent = Extract<Intent, { kind: EditKind }>;

export function isEdit(intent: Intent): intent is EditIntent {
  return (EDIT_KINDS as readonly string[]).includes(intent.kind);
}

/** An edit over nothing in particular would touch the whole workspace: it needs a filter. */
export function hasNarrowingFilter(filter: NamedFilter): boolean {
  return (
    filter.text !== "" ||
    filter.merchant !== "" ||
    filter.category !== "" ||
    filter.account !== "" ||
    filter.amountMin !== null ||
    filter.amountMax !== null
  );
}

/** Case- and accent-insensitive, for matching names the model wrote. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("ca")
    .trim();
}
