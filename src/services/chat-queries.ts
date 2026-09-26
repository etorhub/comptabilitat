/**
 * The chat's read side: from the names the model wrote to rows and figures.
 *
 * Two rules hold everything up:
 *
 *   - **The workspace comes from the URL, never from the model.** Every
 *     condition built here starts from the `ledgerId` the caller passes.
 *   - **The figures come from the database, never from the model.** The model
 *     picks the filters; the sums are SQL, and the answer is a template.
 *
 * Totals follow `countableTransactions()`, like the reports: booked, not a
 * transfer between own accounts, not excluded by hand.
 */

import {
  and,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, categories, merchants, transactions } from "../db/schema/index.ts";
import { formatMoney, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { listCategories } from "./categories.ts";
import {
  fold,
  previousRange,
  resolvePeriod,
  type DateRange,
  type Direction,
  type NamedFilter,
  type PeriodSpec,
} from "./chat-intents.ts";
import { countableTransactions } from "./filters.ts";
import { searchClause, transactionViewsWhere, type TransactionView } from "./transactions.ts";

/** A filter whose names are already ids of this workspace. */
export interface ResolvedFilter {
  ledgerId: number;
  text: string;
  merchantIds: number[] | null;
  merchantLabel: string;
  categoryIds: number[] | null;
  categoryLabel: string;
  accountId: number | null;
  accountLabel: string;
  direction: Direction;
  range: DateRange;
  amountMin: string | null;
  amountMax: string | null;
}

/** When a name matches nothing, or too many things, the chat asks instead of guessing. */
export interface Clarification {
  message: string;
  options: string[];
}

export type Resolution<T> = { ok: true; value: T } | { ok: false; clarify: Clarification };

const MAX_OPTIONS = 8;

// --- Names -----------------------------------------------------------------

export interface CategoryMatch {
  id: number;
  name: string;
  slug: string;
  fullName: string;
  /** Itself and, for a parent, its children: a filter on «Casa» includes «Casa › Llum». */
  ids: number[];
}

export async function categoryCatalog(ledgerId: number): Promise<CategoryMatch[]> {
  const all = await listCategories(ledgerId);
  const byId = new Map(all.map((c) => [c.id, c]));
  return all.map((c) => {
    const parent = c.parentId === null ? undefined : byId.get(c.parentId);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      fullName: parent ? `${parent.name} › ${c.name}` : c.name,
      ids: [c.id, ...all.filter((child) => child.parentId === c.id).map((child) => child.id)],
    };
  });
}

/** Exact matches first (name, full name or slug); then, if there are none, partial ones. */
function matchCategories(catalog: CategoryMatch[], query: string): CategoryMatch[] {
  const q = fold(query);
  const exact = catalog.filter(
    (c) => fold(c.name) === q || fold(c.fullName) === q || fold(c.slug) === q,
  );
  if (exact.length > 0) return exact;
  return catalog.filter((c) => fold(c.fullName).includes(q));
}

export async function resolveCategory(
  ledgerId: number,
  query: string,
  mustBeOne: boolean,
): Promise<Resolution<CategoryMatch[]>> {
  const found = matchCategories(await categoryCatalog(ledgerId), query);
  if (found.length === 0) {
    return {
      ok: false,
      clarify: {
        message: `No trobo cap categoria que es digui «${query}» en aquest espai.`,
        options: [],
      },
    };
  }
  if (found.length > 1 && mustBeOne) {
    return {
      ok: false,
      clarify: {
        message: `Hi ha més d'una categoria que pot ser «${query}». Quina vols dir?`,
        options: found.slice(0, MAX_OPTIONS).map((c) => c.fullName),
      },
    };
  }
  return { ok: true, value: found };
}

export interface MerchantMatch {
  id: number;
  name: string;
}

export async function resolveMerchant(
  ledgerId: number,
  query: string,
  mustBeOne: boolean,
): Promise<Resolution<MerchantMatch[]>> {
  const pattern = `%${query}%`;
  const rows = await db
    .select({
      id: merchants.id,
      name: merchants.displayName,
      normalized: merchants.normalizedName,
    })
    .from(merchants)
    .where(
      and(
        eq(merchants.ledgerId, ledgerId),
        or(ilike(merchants.displayName, pattern), ilike(merchants.normalizedName, pattern)),
      ),
    )
    .orderBy(merchants.displayName)
    .limit(50);

  const found = rows.map((r) => ({ id: r.id, name: r.name || r.normalized }));
  if (found.length === 0) {
    return {
      ok: false,
      clarify: { message: `No trobo cap comerç que es digui «${query}».`, options: [] },
    };
  }
  if (mustBeOne && found.length > 1) {
    const q = fold(query);
    const exact = rows.filter((r) => fold(r.name) === q || fold(r.normalized) === q);
    if (exact.length === 1 && exact[0]) {
      return {
        ok: true,
        value: [{ id: exact[0].id, name: exact[0].name || exact[0].normalized }],
      };
    }
    return {
      ok: false,
      clarify: {
        message: `Hi ha més d'un comerç que pot ser «${query}». Quin vols dir?`,
        options: found.slice(0, MAX_OPTIONS).map((m) => m.name),
      },
    };
  }
  return { ok: true, value: found };
}

export async function accountNames(ledgerId: number): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.ledgerId, ledgerId))
    .orderBy(accounts.name);
}

async function resolveAccount(
  ledgerId: number,
  query: string,
): Promise<Resolution<{ id: number; name: string }>> {
  const all = await accountNames(ledgerId);
  const q = fold(query);
  const exact = all.filter((a) => fold(a.name) === q);
  const found = exact.length > 0 ? exact : all.filter((a) => fold(a.name).includes(q));
  const [only] = found;
  if (found.length === 1 && only) return { ok: true, value: only };
  return {
    ok: false,
    clarify: {
      message:
        found.length === 0
          ? `No trobo cap compte que es digui «${query}».`
          : `Hi ha més d'un compte que pot ser «${query}». Quin vols dir?`,
      options: (found.length === 0 ? all : found).slice(0, MAX_OPTIONS).map((a) => a.name),
    },
  };
}

/** From names to ids. Asks back instead of guessing when a name does not settle it. */
export async function resolveFilter(
  ledgerId: number,
  filter: NamedFilter,
  today: string,
  options: { singleMerchant?: boolean } = {},
): Promise<Resolution<ResolvedFilter>> {
  const resolved: ResolvedFilter = {
    ledgerId,
    text: filter.text,
    merchantIds: null,
    merchantLabel: "",
    categoryIds: null,
    categoryLabel: "",
    accountId: null,
    accountLabel: "",
    direction: filter.direction,
    range: resolvePeriod(filter.period, today),
    amountMin: filter.amountMin,
    amountMax: filter.amountMax,
  };

  if (filter.merchant) {
    const found = await resolveMerchant(
      ledgerId,
      filter.merchant,
      options.singleMerchant ?? false,
    );
    if (!found.ok) return found;
    resolved.merchantIds = found.value.map((m) => m.id);
    resolved.merchantLabel =
      found.value.length === 1 ? (found.value[0]?.name ?? "") : `«${filter.merchant}»`;
  }

  if (filter.category) {
    const found = await resolveCategory(ledgerId, filter.category, false);
    if (!found.ok) return found;
    resolved.categoryIds = [...new Set(found.value.flatMap((c) => c.ids))];
    resolved.categoryLabel = found.value.map((c) => c.fullName).join(", ");
  }

  if (filter.account) {
    const found = await resolveAccount(ledgerId, filter.account);
    if (!found.ok) return found;
    resolved.accountId = found.value.id;
    resolved.accountLabel = found.value.name;
  }

  return { ok: true, value: resolved };
}

// --- The condition ---------------------------------------------------------

const notMasked = or(
  isNull(transactions.displayDescription),
  eq(transactions.displayDescription, ""),
);

/**
 * The SQL for a resolved filter.
 *
 * `report` counts like the reports do. `edit` is what an edit may touch: the
 * workspace's transactions in the range, pending ones included, transfers
 * between own accounts excluded, like the transactions page by default.
 */
export function filterWhere(f: ResolvedFilter, mode: "report" | "edit"): SQL | undefined {
  const parts: (SQL | undefined)[] =
    mode === "report"
      ? [countableTransactions({ workspaces: f.ledgerId, des: f.range.from, to: f.range.to })]
      : [
          eq(transactions.ledgerId, f.ledgerId),
          isNull(transactions.transferGroupId),
          f.range.from ? gte(transactions.bookingDate, f.range.from) : undefined,
          f.range.to ? lte(transactions.bookingDate, f.range.to) : undefined,
        ];

  if (f.text) parts.push(searchClause(`%${f.text}%`));
  // A masked transaction does not say which merchant it is: see `transactionView()`.
  if (f.merchantIds !== null)
    parts.push(inArray(transactions.merchantId, f.merchantIds), notMasked);
  if (f.categoryIds !== null) parts.push(inArray(transactions.categoryId, f.categoryIds));
  if (f.accountId !== null) parts.push(eq(transactions.accountId, f.accountId));
  if (f.direction === "expense") parts.push(sql`${transactions.amount} < 0`);
  if (f.direction === "income") parts.push(sql`${transactions.amount} > 0`);
  if (f.amountMin !== null) parts.push(sql`abs(${transactions.amount}) >= ${f.amountMin}`);
  if (f.amountMax !== null) parts.push(sql`abs(${transactions.amount}) <= ${f.amountMax}`);

  return and(...parts);
}

/** «que contenen «glovo», a la categoria Restaurants, de més de 100,00 €». */
export function describeFilter(f: ResolvedFilter): string {
  const parts: string[] = [];
  if (f.text) parts.push(`que contenen «${f.text}»`);
  if (f.merchantLabel) parts.push(`del comerç ${f.merchantLabel}`);
  if (f.categoryLabel) parts.push(`a ${f.categoryLabel}`);
  if (f.accountLabel) parts.push(`del compte ${f.accountLabel}`);
  if (f.amountMin !== null && f.amountMax !== null) {
    parts.push(`d'entre ${formatMoney(f.amountMin)} i ${formatMoney(f.amountMax)}`);
  } else if (f.amountMin !== null) {
    parts.push(`de ${formatMoney(f.amountMin)} o més`);
  } else if (f.amountMax !== null) {
    parts.push(`de ${formatMoney(f.amountMax)} o menys`);
  }
  return parts.join(", ");
}

/** The query string for the transactions page, with the filters it understands. */
export function transactionsLink(f: ResolvedFilter): string {
  const params = new URLSearchParams();
  if (f.text) params.set("cerca", f.text);
  if (f.range.from) params.set("des", f.range.from);
  if (f.range.to) params.set("to", f.range.to);
  if (f.accountId !== null) params.set("compte", String(f.accountId));
  if (f.categoryIds !== null && f.categoryIds.length === 1) {
    params.set("categoria", String(f.categoryIds[0]));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

// --- The answers -----------------------------------------------------------

export interface Totals {
  expenses: MoneyString;
  income: MoneyString;
  count: number;
}

export interface ListRow {
  id: number;
  bookingDate: string;
  description: string;
  merchantName: string | null;
  categoryName: string | null;
  amount: MoneyString;
  isMasked: boolean;
}

export interface BreakdownPart {
  name: string;
  color: string | null;
  amount: MoneyString;
  count: number;
}

export interface MonthPoint {
  month: string;
  expenses: MoneyString;
  income: MoneyString;
}

/** What an assistant message draws. Stored as JSON in `chat_messages.payload`. */
export type AnswerPayload =
  | {
      kind: "total";
      period: string;
      filter: string;
      direction: Direction;
      totals: Totals;
      link: string;
    }
  | {
      kind: "list";
      period: string;
      filter: string;
      totals: Totals;
      rows: ListRow[];
      link: string;
    }
  | {
      kind: "breakdown";
      period: string;
      filter: string;
      groupBy: "category" | "merchant";
      direction: Direction;
      parts: BreakdownPart[];
    }
  | {
      kind: "series";
      period: string;
      filter: string;
      direction: Direction;
      points: MonthPoint[];
    }
  | {
      kind: "compare";
      filter: string;
      direction: Direction;
      a: Totals & { period: string };
      b: Totals & { period: string };
    }
  | { kind: "proposal"; actionId: number }
  | { kind: "clarify"; options: string[] }
  | { kind: "unknown" }
  | { kind: "forbidden" };

export interface Answer {
  /** One sentence in Catalan: the headline, and what the conversation list quotes. */
  text: string;
  payload: AnswerPayload;
}

export async function totals(where: SQL | undefined): Promise<Totals> {
  const [row] = await db
    .select({
      n: count(),
      income: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(where);
  return {
    count: row?.n ?? 0,
    income: toMoneyString(money(row?.income ?? "0")),
    expenses: toMoneyString(money(row?.expenses ?? "0")),
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** «Has gastat 812,40 € en 37 moviments». */
export function totalsSentence(t: Totals, direction: Direction): string {
  const moves = plural(t.count, "moviment", "moviments");
  if (t.count === 0) return "No hi ha cap moviment que hi encaixi.";
  if (direction === "expense") return `Has gastat ${formatMoney(t.expenses)} en ${moves}.`;
  if (direction === "income") return `Has ingressat ${formatMoney(t.income)} en ${moves}.`;
  return `${moves}: ${formatMoney(t.expenses)} de despeses i ${formatMoney(t.income)} d'ingressos.`;
}

export async function answerTotal(f: ResolvedFilter): Promise<Answer> {
  const t = await totals(filterWhere(f, "report"));
  return {
    text: totalsSentence(t, f.direction),
    payload: {
      kind: "total",
      period: f.range.label,
      filter: describeFilter(f),
      direction: f.direction,
      totals: t,
      link: transactionsLink(f),
    },
  };
}

function listRow(v: TransactionView): ListRow {
  return {
    id: v.id,
    bookingDate: v.bookingDate,
    description: v.description,
    merchantName: v.merchantName,
    categoryName: v.categoryName,
    amount: v.amount,
    isMasked: v.isMasked,
  };
}

export async function answerList(
  f: ResolvedFilter,
  orderBy: "date" | "amount",
  limit: number,
): Promise<Answer> {
  const where = filterWhere(f, "report");
  const [t, views] = await Promise.all([
    totals(where),
    transactionViewsWhere(where, orderBy, limit),
  ]);
  const shown = views.length < t.count ? ` Te n'ensenyo ${views.length}.` : "";
  return {
    text:
      t.count === 0
        ? "No hi ha cap moviment que hi encaixi."
        : `He trobat ${plural(t.count, "moviment", "moviments")}.${shown}`,
    payload: {
      kind: "list",
      period: f.range.label,
      filter: describeFilter(f),
      totals: t,
      rows: views.map(listRow),
      link: transactionsLink(f),
    },
  };
}

export async function answerBreakdown(
  f: ResolvedFilter,
  groupBy: "category" | "merchant",
  limit: number,
): Promise<Answer> {
  // A breakdown with no direction is about spending: that is what people ask.
  const direction: Direction = f.direction === "any" ? "expense" : f.direction;
  const where = filterWhere({ ...f, direction }, "report");
  const total = sql<string>`sum(abs(${transactions.amount}))`;

  let parts: BreakdownPart[];
  if (groupBy === "category") {
    // Grouped by the parent, like `categoryBreakdown()` in the reports.
    const groupName = sql<string | null>`coalesce(pare.name, ${categories.name})`;
    const groupColor = sql<string | null>`coalesce(pare.color, ${categories.color})`;
    const rows = await db
      .select({ name: groupName, color: groupColor, amount: total, n: count(transactions.id) })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(sql`categories as pare`, sql`pare.id = ${categories.parentId}`)
      .where(where)
      .groupBy(groupName, groupColor)
      .orderBy(sql`sum(abs(${transactions.amount})) desc`)
      .limit(limit);
    parts = rows.map((r) => ({
      name: r.name ?? "Sense classificar",
      color: r.color ?? "#94a3b8",
      amount: toMoneyString(money(r.amount)),
      count: r.n,
    }));
  } else {
    // Masked transactions stay out: the merchant is what was hidden.
    const rows = await db
      .select({ name: merchants.displayName, amount: total, n: count(transactions.id) })
      .from(transactions)
      .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(and(where, notMasked))
      .groupBy(merchants.displayName)
      .orderBy(sql`sum(abs(${transactions.amount})) desc`)
      .limit(limit);
    parts = rows.map((r) => ({
      name: r.name || "—",
      color: null,
      amount: toMoneyString(money(r.amount)),
      count: r.n,
    }));
  }

  const [top] = parts;
  const what = groupBy === "category" ? "categoria" : "comerç";
  return {
    text: top
      ? `On més ${direction === "income" ? "has ingressat" : "has gastat"} per ${what}: ${top.name}, amb ${formatMoney(top.amount)}.`
      : "No hi ha cap moviment que hi encaixi.",
    payload: {
      kind: "breakdown",
      period: f.range.label,
      filter: describeFilter(f),
      groupBy,
      direction,
      parts,
    },
  };
}

export async function answerSeries(f: ResolvedFilter): Promise<Answer> {
  const month = sql<string>`substring(${transactions.bookingDate}::text, 1, 7)`;
  const rows = await db
    .select({
      month,
      income: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(filterWhere(f, "report"))
    .groupBy(month)
    .orderBy(month);

  const points = rows.map((r) => ({
    month: r.month,
    income: toMoneyString(money(r.income)),
    expenses: toMoneyString(money(r.expenses)),
  }));
  const direction: Direction = f.direction === "any" ? "expense" : f.direction;
  return {
    text:
      points.length === 0
        ? "No hi ha cap moviment que hi encaixi."
        : `Evolució mes a mes, ${plural(points.length, "mes", "mesos")}.`,
    payload: {
      kind: "series",
      period: f.range.label,
      filter: describeFilter(f),
      direction,
      points,
    },
  };
}

export async function answerCompare(
  f: ResolvedFilter,
  other: PeriodSpec | null,
  today: string,
): Promise<Answer | Clarification> {
  const otherRange = other === null ? previousRange(f.range) : resolvePeriod(other, today);
  if (otherRange === null || (otherRange.from === null && otherRange.to === null)) {
    return {
      message:
        "Per comparar necessito dos períodes concrets: per exemple, «enguany i l'any passat».",
      options: [],
    };
  }

  const [a, b] = await Promise.all([
    totals(filterWhere(f, "report")),
    totals(filterWhere({ ...f, range: otherRange }, "report")),
  ]);
  const key = f.direction === "income" ? "income" : "expenses";
  const difference = money(a[key]).minus(money(b[key]));
  const verb = f.direction === "income" ? "Has ingressat" : "Has gastat";
  const trend = difference.isZero()
    ? "el mateix que"
    : difference.isPositive()
      ? `${formatMoney(difference)} més que`
      : `${formatMoney(difference.abs())} menys que`;

  return {
    text: `${verb} ${trend} en l'altre període (${formatMoney(a[key])} contra ${formatMoney(b[key])}).`,
    payload: {
      kind: "compare",
      filter: describeFilter(f),
      direction: f.direction,
      a: { ...a, period: f.range.label },
      b: { ...b, period: otherRange.label },
    },
  };
}
