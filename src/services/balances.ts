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

export interface SaldoConegut {
  amount: MoneyString;
  currency: string;
  referenceDate: string;
  balanceType: string;
}

/** Ultim saldo conegut d'un compte, preferint el saldo comptable. */
export async function ultimSaldo(accountId: number): Promise<SaldoConegut | null> {
  const [ultima] = await db
    .select({ data: max(balances.referenceDate) })
    .from(balances)
    .where(eq(balances.accountId, accountId));

  if (!ultima?.data) return null;

  const candidats = await db
    .select({
      amount: balances.amount,
      currency: balances.currency,
      referenceDate: balances.referenceDate,
      balanceType: balances.balanceType,
    })
    .from(balances)
    .where(and(eq(balances.accountId, accountId), eq(balances.referenceDate, ultima.data)));

  if (candidats.length === 0) return null;

  const posicio = (tipus: string) => {
    const i = BALANCE_TYPE_PRIORITY.indexOf(tipus);
    return i === -1 ? BALANCE_TYPE_PRIORITY.length : i;
  };
  candidats.sort((a, b) => posicio(a.balanceType) - posicio(b.balanceType));

  return candidats[0] ?? null;
}

export interface SaldoEspai {
  total: MoneyString;
  /** La data del saldo mes recent que s'ha fet servir. */
  data: string | null;
}

/** Suma dels ultims saldos coneguts dels comptes actius d'un espai. */
export async function saldoEspai(ledgerId: number): Promise<SaldoEspai> {
  const comptes = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.isActive, true)));

  let total = new Decimal(0);
  let data: string | null = null;

  for (const compte of comptes) {
    const saldo = await ultimSaldo(compte.id);
    if (saldo === null) continue;
    total = total.plus(money(saldo.amount));
    if (data === null || saldo.referenceDate > data) data = saldo.referenceDate;
  }

  return { total: toMoneyString(total), data };
}

export interface PuntSaldo {
  dia: string;
  saldo: MoneyString;
}

/**
 * Evolucio diaria del saldo, reconstruida cap enrere des del saldo d'avui.
 */
export async function serieSaldos(
  ledgerIds: number[],
  dataDes: string,
  dataFins: string,
): Promise<PuntSaldo[]> {
  if (ledgerIds.length === 0) return [];

  let actual = new Decimal(0);
  for (const ledgerId of ledgerIds) {
    actual = actual.plus(money((await saldoEspai(ledgerId)).total));
  }

  const files = await db
    .select({ dia: transactions.bookingDate, total: sum(transactions.amount) })
    .from(transactions)
    .where(
      and(
        inArray(transactions.ledgerId, ledgerIds),
        gt(transactions.bookingDate, dataDes),
        lte(transactions.bookingDate, dataFins),
      ),
    )
    .groupBy(transactions.bookingDate)
    .orderBy(asc(transactions.bookingDate));

  const perDia = new Map(files.map((f) => [f.dia, money(f.total ?? "0")]));

  const serie: PuntSaldo[] = [];
  let cursor = dataFins;
  let corrent = actual;
  while (cursor >= dataDes) {
    serie.push({ dia: cursor, saldo: toMoneyString(corrent) });
    corrent = corrent.minus(perDia.get(cursor) ?? new Decimal(0));
    cursor = addDays(cursor, -1);
  }
  serie.reverse();
  return serie;
}
