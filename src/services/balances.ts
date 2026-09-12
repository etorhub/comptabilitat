/**
 * Saldos.
 *
 * El banc nomes dona el saldo d'avui. La corba historica, doncs, no es
 * consulta: es **reconstrueix cap enrere** restant els moviments de cada dia
 * al saldo conegut.
 *
 * Traduccio de `backend/app/services/balances.py`.
 */

import { and, asc, eq, gt, inArray, lte, max, sum } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, balances, transactions } from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { addDays } from "../lib/time.ts";

/** Ordre de preferencia: comptable tancat, disponible, i despres qualsevol. */
const BALANCE_TYPE_PRIORITY = ["CLBD", "CLAV", "ITAV", "XPCD", "OTHR"];

export interface BalanceKnown {
  amount: MoneyString;
  currency: string;
  referenceDate: string;
  balanceType: string;
}

/** Ultim saldo conegut d'un compte, preferint el saldo comptable. */
export async function lastBalance(accountId: number): Promise<BalanceKnown | null> {
  const [last] = await db
    .select({ date: max(balances.referenceDate) })
    .from(balances)
    .where(eq(balances.accountId, accountId));

  if (!last?.date) return null;

  const candidats = await db
    .select({
      amount: balances.amount,
      currency: balances.currency,
      referenceDate: balances.referenceDate,
      balanceType: balances.balanceType,
    })
    .from(balances)
    .where(and(eq(balances.accountId, accountId), eq(balances.referenceDate, last.date)));

  if (candidats.length === 0) return null;

  const posicio = (type: string) => {
    const i = BALANCE_TYPE_PRIORITY.indexOf(type);
    return i === -1 ? BALANCE_TYPE_PRIORITY.length : i;
  };
  candidats.sort((a, b) => posicio(a.balanceType) - posicio(b.balanceType));

  return candidats[0] ?? null;
}

export interface WorkspaceBalance {
  total: MoneyString;
  /** La data del saldo mes recent que s'ha fet servir. */
  date: string | null;
}

/** Suma dels ultims saldos coneguts dels comptes actius d'un espai. */
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
 * Evolucio diaria del saldo, reconstruida cap enrere des del saldo d'avui.
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
  let corrent = actual;
  while (cursor >= dateFrom) {
    series.push({ day: cursor, balance: toMoneyString(corrent) });
    corrent = corrent.minus(byDay.get(cursor) ?? new Decimal(0));
    cursor = addDays(cursor, -1);
  }
  series.reverse();
  return series;
}
