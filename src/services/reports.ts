/**
 * Aggregates for the dashboards and the reports.
 *
 * The invariant of this whole file: **transfers between the owner's own
 * accounts and excluded transactions never count** as income or as expense,
 * they only move money around. And only booked transactions (`booked`) are
 * counted, not the pending ones.
 *
 * A translation of `backend/app/services/reports.py`. The Python used
 * PostgreSQL's `to_char` to group by month; here it is done with `substring`,
 * which does the same over a `date` column and ties us less to the engine.
 */

import { and, count, eq, inArray, isNull, sql, sum, type SQL } from "drizzle-orm";

import { db } from "../db/client.ts";
import { categories, merchants, transactions } from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { todayLocal } from "../lib/time.ts";
import { countableTransactions } from "./filtres.ts";

/** See `services/filtres.ts`: the definition lives in one place. */
function baseFilter(
  ledgerIds: number[],
  dateFrom: string | null,
  dateTo: string | null,
): SQL | undefined {
  return countableTransactions({ workspaces: ledgerIds, des: dateFrom, fins: dateTo });
}

/** First day of the month and first day of the next month. */
export function monthBounds(referencia?: string): [string, string] {
  const base = referencia ?? todayLocal();
  const any = Number(base.slice(0, 4));
  const month = Number(base.slice(5, 7));
  const first = `${base.slice(0, 7)}-01`;
  const next =
    month === 12 ? `${any + 1}-01-01` : `${any}-${String(month + 1).padStart(2, "0")}-01`;
  return [first, next];
}

export interface IncomeAndExpenses {
  income: MoneyString;
  /** Positive, even though in the database they are negative. */
  expenses: MoneyString;
  cleaned: MoneyString;
}

export async function incomeAndExpenses(
  ledgerIds: number[],
  dateFrom: string | null,
  dateTo: string | null,
): Promise<IncomeAndExpenses> {
  if (ledgerIds.length === 0) {
    return { income: "0.00", expenses: "0.00", cleaned: "0.00" };
  }

  const [row] = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(baseFilter(ledgerIds, dateFrom, dateTo));

  const income = money(row?.income ?? "0");
  const expenses = money(row?.expenses ?? "0");

  return {
    income: toMoneyString(income),
    expenses: toMoneyString(expenses),
    cleaned: toMoneyString(income.minus(expenses)),
  };
}

export interface MonthlyPoint {
  periode: string;
  income: MoneyString;
  /** Total expenses (= fixed + variable). */
  expenses: MoneyString;
  /** Expenses linked to an occurrence of a recurring series. */
  despesesFixes: MoneyString;
  /** Expenses that are not from a recurring series. */
  despesesVariables: MoneyString;
  cleaned: MoneyString;
}

/** The transaction has at least one occurrence in `recurring_occurrences`. */
const isFixedExpense = sql`exists (
  select 1 from recurring_occurrences
  where recurring_occurrences.transaction_id = ${transactions.id}
)`;

/** Income, expenses (fixed / variable) and result for each month. */
export async function monthlySeries(
  ledgerIds: number[],
  dateFrom: string,
  dateTo: string,
): Promise<MonthlyPoint[]> {
  if (ledgerIds.length === 0) return [];

  const periode = sql<string>`substring(${transactions.bookingDate}::text, 1, 7)`;

  const rows = await db
    .select({
      periode,
      income: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
      despesesFixes: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 and ${isFixedExpense} then -${transactions.amount} else 0 end), 0)`,
      despesesVariables: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 and not ${isFixedExpense} then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(baseFilter(ledgerIds, dateFrom, dateTo))
    .groupBy(periode)
    .orderBy(periode);

  return rows.map((f) => {
    const income = money(f.income);
    const expenses = money(f.expenses);
    return {
      periode: f.periode,
      income: toMoneyString(income),
      expenses: toMoneyString(expenses),
      despesesFixes: toMoneyString(money(f.despesesFixes)),
      despesesVariables: toMoneyString(money(f.despesesVariables)),
      cleaned: toMoneyString(income.minus(expenses)),
    };
  });
}

export interface CategoryPart {
  categoryId: number | null;
  categoryName: string;
  color: string;
  amount: MoneyString;
  /** Share of the total, from 0 to 1. */
  share: number;
  transactions: number;
}

/**
 * Breakdown by category, **grouping by the parent category**.
 *
 * The transactions of a subcategory count under their parent; those that have
 * no parent or are not classified stay as they are.
 */
export async function categoryBreakdown(
  ledgerIds: number[],
  dateFrom: string | null,
  dateTo: string | null,
  expenses = true,
  limit = 30,
): Promise<CategoryPart[]> {
  if (ledgerIds.length === 0) return [];

  const parent = sql`pare`;
  const groupId = sql<number | null>`coalesce(pare.id, ${categories.id})`;
  const groupName = sql<string | null>`coalesce(pare.name, ${categories.name})`;
  const groupColor = sql<string | null>`coalesce(pare.color, ${categories.color})`;
  const total = sql<string>`sum(abs(${transactions.amount}))`;

  const rows = await db
    .select({
      groupId: groupId,
      groupName: groupName,
      color: groupColor,
      amount: total,
      transaccions: count(transactions.id),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(sql`categories as ${parent}`, sql`pare.id = ${categories.parentId}`)
    .where(
      and(
        baseFilter(ledgerIds, dateFrom, dateTo),
        expenses ? sql`${transactions.amount} < 0` : sql`${transactions.amount} > 0`,
      ),
    )
    .groupBy(groupId, groupName, groupColor)
    .orderBy(sql`sum(abs(${transactions.amount})) desc`)
    .limit(limit);

  const suma = rows.reduce((acc, f) => acc.plus(money(f.amount)), new Decimal(0));

  return rows.map((f) => ({
    categoryId: f.groupId,
    categoryName: f.groupName ?? "Sense classificar",
    color: f.color ?? "#94a3b8",
    amount: toMoneyString(money(f.amount)),
    share: suma.isZero() ? 0 : money(f.amount).dividedBy(suma).toNumber(),
    transactions: f.transaccions,
  }));
}

export interface MerchantPart {
  merchantId: number | null;
  merchantName: string;
  amount: MoneyString;
  transactions: number;
}

/**
 * The merchants where the most was spent.
 *
 * **Masked transactions do not appear here**: the merchant's name is
 * precisely what was meant to be hidden, and a ranking like this would show
 * it again.
 */
export async function merchantBreakdown(
  ledgerIds: number[],
  dateFrom: string | null,
  dateTo: string | null,
  limit = 20,
): Promise<MerchantPart[]> {
  if (ledgerIds.length === 0) return [];

  const total = sql<string>`sum(abs(${transactions.amount}))`;

  const rows = await db
    .select({
      merchantId: transactions.merchantId,
      merchantName: merchants.displayName,
      amount: total,
      transaccions: count(transactions.id),
    })
    .from(transactions)
    .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        baseFilter(ledgerIds, dateFrom, dateTo),
        sql`${transactions.amount} < 0`,
        isNull(transactions.displayDescription),
      ),
    )
    .groupBy(transactions.merchantId, merchants.displayName)
    .orderBy(sql`sum(abs(${transactions.amount})) desc`)
    .limit(limit);

  return rows.map((f) => ({
    merchantId: f.merchantId,
    merchantName: f.merchantName ?? "—",
    amount: toMoneyString(money(f.amount)),
    transactions: f.transaccions,
  }));
}

export async function countPendingReview(ledgerIds: number[]): Promise<number> {
  if (ledgerIds.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(inArray(transactions.ledgerId, ledgerIds), eq(transactions.needsReview, true)));
  return row?.n ?? 0;
}

export async function countUnclassified(ledgerIds: number[]): Promise<number> {
  if (ledgerIds.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(
      and(
        inArray(transactions.ledgerId, ledgerIds),
        isNull(transactions.categoryId),
        isNull(transactions.transferGroupId),
        eq(transactions.isExcluded, false),
      ),
    );
  return row?.n ?? 0;
}

export { sum };
