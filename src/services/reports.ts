/**
 * Agregats per als panells i els informes.
 *
 * La invariant de tot aquest fitxer: **els traspassos entre comptes propis i
 * els moviments exclosos no compten mai** com a ingres ni com a despesa,
 * nomes mouen diners de lloc. I nomes es conten els moviments definitius
 * (`booked`), no els pendents.
 *
 * Traduccio de `backend/app/services/reports.py`. El Python feia servir
 * `to_char` de PostgreSQL per agrupar per mes; aqui es fa amb `substring`,
 * que fa el mateix sobre una columna `date` i no lliga tant amb el motor.
 */

import { and, count, eq, inArray, isNull, sql, sum, type SQL } from "drizzle-orm";

import { db } from "../db/client.ts";
import { categories, merchants, transactions } from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { todayLocal } from "../lib/time.ts";
import { countableTransactions } from "./filtres.ts";

/** Vegeu `services/filtres.ts`: la definicio viu en un sol lloc. */
function baseFilter(
  ledgerIds: number[],
  dateFrom: string | null,
  dateTo: string | null,
): SQL | undefined {
  return countableTransactions({ workspaces: ledgerIds, des: dateFrom, fins: dateTo });
}

/** Primer dia del mes i primer dia del mes següent. */
export function monthBounds(referencia?: string): [string, string] {
  const base = referencia ?? todayLocal();
  const any = Number(base.slice(0, 4));
  const mes = Number(base.slice(5, 7));
  const first = `${base.slice(0, 7)}-01`;
  const next =
    mes === 12 ? `${any + 1}-01-01` : `${any}-${String(mes + 1).padStart(2, "0")}-01`;
  return [first, next];
}

export interface IncomeAndExpenses {
  income: MoneyString;
  /** En positiu, tot i que a la base de dades son negatius. */
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
  /** Total de despeses (= fixes + variables). */
  expenses: MoneyString;
  /** Despeses lligades a una aparicio de serie recurrent. */
  despesesFixes: MoneyString;
  /** Despeses que no son d'una serie recurrent. */
  despesesVariables: MoneyString;
  cleaned: MoneyString;
}

/** El moviment te almenys una aparicio a `recurring_occurrences`. */
const isFixedExpense = sql`exists (
  select 1 from recurring_occurrences
  where recurring_occurrences.transaction_id = ${transactions.id}
)`;

/** Ingressos, despeses (fixes / variables) i resultat de cada mes. */
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
  /** Part del total, de 0 a 1. */
  share: number;
  transactions: number;
}

/**
 * Repartiment per categoria, **agrupant per la categoria pare**.
 *
 * Els moviments d'una subcategoria compten sota el seu pare; els que no en
 * tenen o no estan classificats, es queden com estan.
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
 * Els comerços on mes s'ha gastat.
 *
 * **Els moviments emmascarats no hi surten**: el nom del comerç es
 * precisament el que s'ha volgut amagar, i un rang com aquest el tornaria a
 * ensenyar.
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
