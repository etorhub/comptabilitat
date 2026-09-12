/**
 * Balances.
 *
 * The bank only gives today's balance. The historical curve, therefore, is
 * not queried: it is **rebuilt backwards** by subtracting each day's
 * transactions from the known balance.
 *
 * A translation of `backend/app/services/balances.py`.
 */

import { and, asc, eq, gt, inArray, lte, max, sum } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, balances, transactions } from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { addDays } from "../lib/time.ts";

/** Order of preference: closing booked, available, and then any. */
const BALANCE_TYPE_PRIORITY = ["CLBD", "CLAV", "ITAV", "XPCD", "OTHR"];

export interface BalanceKnown {
  amount: MoneyString;
  currency: string;
  referenceDate: string;
  balanceType: string;
}

/** An account's last known balance, preferring the booked balance. */
export async function lastBalance(accountId: number): Promise<BalanceKnown | null> {
  const [last] = await db
    .select({ date: max(balances.referenceDate) })
    .from(balances)
    .where(eq(balances.accountId, accountId));

  if (!last?.date) return null;

  const candidates = await db
    .select({
      amount: balances.amount,
      currency: balances.currency,
      referenceDate: balances.referenceDate,
      balanceType: balances.balanceType,
    })
    .from(balances)
    .where(and(eq(balances.accountId, accountId), eq(balances.referenceDate, last.date)));

  if (candidates.length === 0) return null;

  const position = (type: string) => {
    const i = BALANCE_TYPE_PRIORITY.indexOf(type);
    return i === -1 ? BALANCE_TYPE_PRIORITY.length : i;
  };
  candidates.sort((a, b) => position(a.balanceType) - position(b.balanceType));

  return candidates[0] ?? null;
}

export interface WorkspaceBalance {
  total: MoneyString;
  /** The date of the most recent balance used. */
  date: string | null;
}

/** Sum of the last known balances of a workspace's active accounts. */
export async function workspaceBalance(ledgerId: number): Promise<WorkspaceBalance> {
  const accountList = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.isActive, true)));

  let total = new Decimal(0);
  let date: string | null = null;

  for (const account of accountList) {
    const balance = await lastBalance(account.id);
    if (balance === null) continue;
    total = total.plus(money(balance.amount));
    if (date === null || balance.referenceDate > date) date = balance.referenceDate;
  }

  return { total: toMoneyString(total), date };
}

export interface BalancePoint {
  day: string;
  balance: MoneyString;
}

/**
 * Daily evolution of the balance, rebuilt backwards from today's balance.
 */
export async function balanceSeries(
  ledgerIds: number[],
  dateFrom: string,
  dateTo: string,
): Promise<BalancePoint[]> {
  if (ledgerIds.length === 0) return [];

  let actual = new Decimal(0);
  for (const ledgerId of ledgerIds) {
    actual = actual.plus(money((await workspaceBalance(ledgerId)).total));
  }

  const rows = await db
    .select({ day: transactions.bookingDate, total: sum(transactions.amount) })
    .from(transactions)
    .where(
      and(
        inArray(transactions.ledgerId, ledgerIds),
        gt(transactions.bookingDate, dateFrom),
        lte(transactions.bookingDate, dateTo),
      ),
    )
    .groupBy(transactions.bookingDate)
    .orderBy(asc(transactions.bookingDate));

  const byDay = new Map(rows.map((f) => [f.day, money(f.total ?? "0")]));

  const series: BalancePoint[] = [];
  let cursor = dateTo;
  let running = actual;
  while (cursor >= dateFrom) {
    series.push({ day: cursor, balance: toMoneyString(running) });
    running = running.minus(byDay.get(cursor) ?? new Decimal(0));
    cursor = addDays(cursor, -1);
  }
  series.reverse();
  return series;
}
