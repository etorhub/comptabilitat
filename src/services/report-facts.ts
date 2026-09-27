/**
 * The figures behind the written reports.
 *
 * **The model never computes anything.** A 4B model on a CPU gets sums wrong
 * with total confidence, and in accounting a wrong figure written in good
 * prose is worse than no prose at all. So everything the report says is
 * computed here, with `Decimal`, and the model is only asked to put it into
 * words (`lib/ollama/report-prompts.ts`). The page draws these same facts
 * next to the text, so a reader can always check one against the other.
 *
 * Every amount leaves here as a `MoneyString`, positive for expenses, because
 * the facts are stored as JSON and read back by the page.
 *
 * What counts is `countableTransactions()`, as everywhere else: no transfers
 * between own accounts, nothing excluded, only booked transactions. And the
 * masking holds: a masked transaction appears by its alias and its merchant is
 * never named (see `services/transactions.ts`).
 */

import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
} from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, ZERO, type MoneyString } from "../lib/money.ts";
import { addDays } from "../lib/time.ts";
import { workspaceBalance } from "./balances.ts";
import { countableTransactions } from "./filters.ts";
import { eventsExpected } from "./forecast.ts";
import { categoryBreakdown, incomeAndExpenses, monthBounds, monthlySeries } from "./reports.ts";
import { transactionViewsWhere } from "./transactions.ts";

// --- Thresholds --------------------------------------------------------------

/** An expense outside every recurring series is worth mentioning from here on. */
export const OUTSIDE_RECURRING_MIN = new Decimal("100");
/** How many of those the report lists, biggest first. */
export const OUTSIDE_RECURRING_LIMIT = 8;
/** A category has shot up when it reaches this many times its usual month… */
export const SPIKE_RATIO = new Decimal("1.5");
/** …and the difference is at least this much, so 12 € against 7 € says nothing. */
export const SPIKE_MIN_DIFFERENCE = new Decimal("50");
/** How many previous months make "its usual month". */
export const SPIKE_HISTORY_MONTHS = 6;
/** With fewer months of data than this, there is no usual month to compare against. */
export const SPIKE_MIN_MONTHS = 2;
/** A merchant paid for the first time is worth mentioning from here on. */
export const NEW_MERCHANT_MIN = new Decimal("30");
/** Each list stays short: a report that lists everything highlights nothing. */
const LIST_LIMIT = 6;

// --- Types ---------------------------------------------------------------------

export interface OutsideRecurring {
  date: string;
  label: string;
  category: string | null;
  amount: MoneyString;
}

export interface CategorySpike {
  category: string;
  amount: MoneyString;
  /** The average month over the previous ones that had any data. */
  usual: MoneyString;
}

export interface DearerBill {
  label: string;
  date: string;
  amount: MoneyString;
  expected: MoneyString;
}

export interface NewMerchant {
  label: string;
  date: string;
  amount: MoneyString;
}

export interface Unexpected {
  outsideRecurring: OutsideRecurring[];
  categorySpikes: CategorySpike[];
  dearerBills: DearerBill[];
  newMerchants: NewMerchant[];
}

export interface Totals {
  income: MoneyString;
  expenses: MoneyString;
  result: MoneyString;
}

export interface CategoryShare {
  category: string;
  amount: MoneyString;
  /** From 0 to 100, already rounded. */
  percent: number;
}

export interface MonthlyFacts {
  kind: "monthly";
  /** `YYYY-MM`. */
  month: string;
  from: string;
  to: string;
  totals: Totals;
  fixedExpenses: MoneyString;
  variableExpenses: MoneyString;
  previous: Totals;
  topCategories: CategoryShare[];
  unexpected: Unexpected;
}

export interface ExpectedBill {
  date: string;
  label: string;
  /** Signed: negative is a bill, positive is money coming in. */
  amount: MoneyString;
}

export interface DailyFacts {
  kind: "daily";
  /** `YYYY-MM-DD`. */
  day: string;
  month: string;
  /** From the first of the month to today. */
  totals: Totals;
  /** Last month, from its first day to the same day number. */
  lastMonthToDate: Totals;
  /** Null when the workspace has no account with a known balance. */
  balance: MoneyString | null;
  balanceDate: string | null;
  /** What is still expected from today to the end of the month. */
  expected: ExpectedBill[];
  expectedTotal: MoneyString;
  projectedBalance: MoneyString | null;
  unexpected: Unexpected;
}

export type ReportFacts = MonthlyFacts | DailyFacts;

// --- Calendar ------------------------------------------------------------------

/** `2026-09` moved by `n` months: `shiftMonth("2026-01", -1)` is `2025-12`. */
export function shiftMonth(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last calendar day of a `YYYY-MM`. */
export function lastDayOf(month: string): string {
  const [, next] = monthBounds(`${month}-01`);
  return addDays(next, -1);
}

/** The same day number a month earlier, clamped: 31 March gives 28 (or 29) February. */
export function sameDayLastMonth(day: string): string {
  const previous = shiftMonth(day.slice(0, 7), -1);
  const last = lastDayOf(previous);
  const candidate = `${previous}-${day.slice(8, 10)}`;
  return candidate > last ? last : candidate;
}

// --- Pure checks (unit-tested) -------------------------------------------------

/**
 * The usual month of a category, or null when there is not enough history.
 *
 * `history` holds one amount per previous month **that had any data at all**;
 * a month when the category was not used counts as zero, a month when nothing
 * was imported yet does not count.
 */
export function usualMonth(history: readonly Decimal[]): Decimal | null {
  if (history.length < SPIKE_MIN_MONTHS) return null;
  const total = history.reduce((acc, v) => acc.plus(v), ZERO);
  return total.dividedBy(history.length).toDecimalPlaces(2);
}

/** Whether `current` is well above `usual`, by ratio and by amount. */
export function isSpike(current: Decimal, usual: Decimal): boolean {
  if (usual.isZero()) return current.gte(SPIKE_MIN_DIFFERENCE);
  return (
    current.gte(usual.times(SPIKE_RATIO)) && current.minus(usual).gte(SPIKE_MIN_DIFFERENCE)
  );
}

/** Whether a bill came in above what was expected, beyond the series' tolerance. */
export function isDearer(amount: Decimal, expected: Decimal, tolerance: Decimal): boolean {
  return amount.abs().minus(expected.abs()).gt(tolerance.abs());
}

function totalsOf(income: MoneyString, expenses: MoneyString): Totals {
  return {
    income,
    expenses,
    result: toMoneyString(money(income).minus(money(expenses))),
  };
}

// --- Queries -------------------------------------------------------------------

/** Whether the workspace has any countable transaction in the range. */
export async function hasActivity(
  ledgerId: number,
  from: string,
  to: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(countableTransactions({ workspaces: ledgerId, des: from, to }))
    .limit(1);
  return row !== undefined;
}

/**
 * Big expenses that belong to no recurring series and to no habitual merchant.
 *
 * "Habitual" means paid in at least `SPIKE_MIN_MONTHS` of the previous
 * `SPIKE_HISTORY_MONTHS` months: the weekly shop is not a series (its amount
 * changes too much), but nobody would call it unexpected either.
 */
async function outsideRecurring(
  ledgerId: number,
  month: string,
  from: string,
  to: string,
): Promise<OutsideRecurring[]> {
  const historyFrom = `${shiftMonth(month, -SPIKE_HISTORY_MONTHS)}-01`;
  const rows = await transactionViewsWhere(
    and(
      countableTransactions({ workspaces: ledgerId, des: from, to, onlyExpenses: true }),
      lte(transactions.amount, OUTSIDE_RECURRING_MIN.negated().toFixed(2)),
      sql`not exists (
        select 1 from recurring_occurrences
        where recurring_occurrences.transaction_id = ${transactions.id}
      )`,
      sql`(${transactions.merchantId} is null or (
        select count(distinct substring(h.booking_date::text, 1, 7))
        from transactions h
        where h.merchant_id = ${transactions.merchantId}
          and h.ledger_id = ${ledgerId}
          and h.status = 'booked'
          and h.transfer_group_id is null
          and h.is_excluded = false
          and h.amount < 0
          and h.booking_date >= ${historyFrom}
          and h.booking_date < ${from}
      ) < ${SPIKE_MIN_MONTHS})`,
    ),
    "amount",
    OUTSIDE_RECURRING_LIMIT,
  );

  // `transactionView()` already masked them: a masked one has no merchant name
  // and its description is the alias.
  return rows.map((t) => ({
    date: t.bookingDate,
    label: t.merchantName ?? t.description,
    category: t.categoryName,
    amount: toMoneyString(money(t.amount).abs()),
  }));
}

/** Parent categories spending well above their usual month. */
async function categorySpikes(
  ledgerId: number,
  month: string,
  to: string,
): Promise<CategorySpike[]> {
  const historyFrom = `${shiftMonth(month, -SPIKE_HISTORY_MONTHS)}-01`;
  const periode = sql<string>`substring(${transactions.bookingDate}::text, 1, 7)`;
  const groupName = sql<string | null>`coalesce(pare.name, ${categories.name})`;

  const [rows, months] = await Promise.all([
    db
      .select({
        periode,
        category: groupName,
        amount: sql<string>`sum(-${transactions.amount})`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(sql`categories as pare`, sql`pare.id = ${categories.parentId}`)
      .where(
        countableTransactions({
          workspaces: ledgerId,
          des: historyFrom,
          to,
          onlyExpenses: true,
        }),
      )
      .groupBy(periode, groupName),
    // The months with any data at all: a month before the first import is not
    // a month of zero spending.
    db
      .selectDistinct({ periode })
      .from(transactions)
      .where(countableTransactions({ workspaces: ledgerId, des: historyFrom, to })),
  ]);

  const previousMonths = months.map((m) => m.periode).filter((p) => p < month);
  const byCategory = new Map<string, Map<string, Decimal>>();
  for (const row of rows) {
    const name = row.category ?? "";
    if (name === "") continue;
    const perMonth = byCategory.get(name) ?? new Map<string, Decimal>();
    perMonth.set(row.periode, money(row.amount));
    byCategory.set(name, perMonth);
  }

  const spikes: { spike: CategorySpike; excess: Decimal }[] = [];
  for (const [category, perMonth] of byCategory) {
    const current = perMonth.get(month) ?? ZERO;
    if (current.isZero()) continue;
    const usual = usualMonth(previousMonths.map((p) => perMonth.get(p) ?? ZERO));
    if (usual === null || !isSpike(current, usual)) continue;
    spikes.push({
      spike: { category, amount: toMoneyString(current), usual: toMoneyString(usual) },
      excess: current.minus(usual),
    });
  }

  return spikes
    .toSorted((a, b) => b.excess.comparedTo(a.excess))
    .slice(0, LIST_LIMIT)
    .map((s) => s.spike);
}

/** Bills from an active series that came in above the expected amount. */
async function dearerBills(ledgerId: number, from: string, to: string): Promise<DearerBill[]> {
  const rows = await db
    .select({
      label: recurringSeries.label,
      date: recurringOccurrences.occurredOn,
      amount: recurringOccurrences.amount,
      expected: recurringSeries.expectedAmount,
      tolerance: recurringSeries.amountTolerance,
    })
    .from(recurringOccurrences)
    .innerJoin(recurringSeries, eq(recurringSeries.id, recurringOccurrences.seriesId))
    .innerJoin(transactions, eq(transactions.id, recurringOccurrences.transactionId))
    .where(
      and(
        countableTransactions({ workspaces: ledgerId, des: from, to, onlyExpenses: true }),
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        gte(recurringOccurrences.occurredOn, from),
        lte(recurringOccurrences.occurredOn, to),
      ),
    );

  return rows
    .filter((r) => isDearer(money(r.amount), money(r.expected), money(r.tolerance)))
    .map((r) => ({
      label: r.label,
      date: r.date,
      amount: toMoneyString(money(r.amount).abs()),
      expected: toMoneyString(money(r.expected).abs()),
    }))
    .toSorted((a, b) =>
      money(b.amount)
        .minus(money(b.expected))
        .comparedTo(money(a.amount).minus(money(a.expected))),
    )
    .slice(0, LIST_LIMIT);
}

/**
 * Merchants paid for the first time in the period.
 *
 * Masked transactions are left out: the merchant's name is exactly what the
 * alias hides, and "new merchant: X" would say it again.
 */
async function newMerchants(
  ledgerId: number,
  from: string,
  to: string,
): Promise<NewMerchant[]> {
  const first = sql<string>`min(${transactions.bookingDate})`;
  const spent = sql<string>`coalesce(sum(case when ${transactions.bookingDate} <= ${to} then -${transactions.amount} else 0 end), 0)`;

  const rows = await db
    .select({ label: merchants.displayName, date: first, amount: spent })
    .from(transactions)
    .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        countableTransactions({ workspaces: ledgerId, onlyExpenses: true }),
        isNotNull(transactions.merchantId),
        isNull(transactions.displayDescription),
      ),
    )
    .groupBy(merchants.id, merchants.displayName)
    .having(sql`min(${transactions.bookingDate}) between ${from} and ${to}`);

  return rows
    .filter((r) => money(r.amount).gte(NEW_MERCHANT_MIN))
    .map((r) => ({ label: r.label, date: r.date, amount: toMoneyString(money(r.amount)) }))
    .toSorted((a, b) => money(b.amount).comparedTo(money(a.amount)))
    .slice(0, LIST_LIMIT);
}

async function unexpected(
  ledgerId: number,
  month: string,
  from: string,
  to: string,
): Promise<Unexpected> {
  const [outside, spikes, dearer, fresh] = await Promise.all([
    outsideRecurring(ledgerId, month, from, to),
    categorySpikes(ledgerId, month, to),
    dearerBills(ledgerId, from, to),
    newMerchants(ledgerId, from, to),
  ]);
  return {
    outsideRecurring: outside,
    categorySpikes: spikes,
    dearerBills: dearer,
    newMerchants: fresh,
  };
}

// --- The two reports ---------------------------------------------------------

/** Everything the monthly report of `month` (`YYYY-MM`) talks about. */
export async function monthlyFacts(ledgerId: number, month: string): Promise<MonthlyFacts> {
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const previousMonth = shiftMonth(month, -1);

  const [totals, previous, series, breakdown, surprises] = await Promise.all([
    incomeAndExpenses([ledgerId], from, to),
    incomeAndExpenses([ledgerId], `${previousMonth}-01`, lastDayOf(previousMonth)),
    monthlySeries([ledgerId], from, to),
    categoryBreakdown([ledgerId], from, to, true, LIST_LIMIT),
    unexpected(ledgerId, month, from, to),
  ]);

  const point = series[0];
  const expenses = money(totals.expenses);

  return {
    kind: "monthly",
    month,
    from,
    to,
    totals: totalsOf(totals.income, totals.expenses),
    fixedExpenses: point?.fixedExpenses ?? "0.00",
    variableExpenses: point?.variableExpenses ?? "0.00",
    previous: totalsOf(previous.income, previous.expenses),
    topCategories: breakdown.map((c) => ({
      category: c.categoryName,
      amount: c.amount,
      percent: expenses.isZero()
        ? 0
        : money(c.amount).dividedBy(expenses).times(100).toDecimalPlaces(0).toNumber(),
    })),
    unexpected: surprises,
  };
}

/** Everything the morning brief of `day` (`YYYY-MM-DD`) talks about. */
export async function dailyFacts(ledgerId: number, day: string): Promise<DailyFacts> {
  const month = day.slice(0, 7);
  const from = `${month}-01`;
  const monthEnd = lastDayOf(month);
  const lastMonthFrom = `${shiftMonth(month, -1)}-01`;

  const [totals, lastMonth, balance, events, surprises] = await Promise.all([
    incomeAndExpenses([ledgerId], from, day),
    incomeAndExpenses([ledgerId], lastMonthFrom, sameDayLastMonth(day)),
    workspaceBalance(ledgerId),
    // From tomorrow: what is booked today is already in the balance.
    eventsExpected(ledgerId, monthEnd, addDays(day, 1)),
    unexpected(ledgerId, month, from, day),
  ]);

  const expectedTotal = events.reduce((acc, e) => acc.plus(money(e.amount)), ZERO);
  const known = balance.date !== null;

  return {
    kind: "daily",
    day,
    month,
    totals: totalsOf(totals.income, totals.expenses),
    lastMonthToDate: totalsOf(lastMonth.income, lastMonth.expenses),
    balance: known ? balance.total : null,
    balanceDate: balance.date,
    expected: events.map((e) => ({ date: e.day, label: e.label, amount: e.amount })),
    expectedTotal: toMoneyString(expectedTotal),
    projectedBalance: known ? toMoneyString(money(balance.total).plus(expectedTotal)) : null,
    unexpected: surprises,
  };
}

/** How many unexpected items the facts carry, for the summaries of the jobs. */
export function unexpectedCount(u: Unexpected): number {
  return (
    u.outsideRecurring.length +
    u.categorySpikes.length +
    u.dearerBills.length +
    u.newMerchants.length
  );
}
