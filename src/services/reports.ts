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

import { and, count, eq, gte, inArray, isNull, lte, sql, sum, type SQL } from "drizzle-orm";

import { db } from "../db/client.ts";
import { categories, merchants, transactions } from "../db/schema/index.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { todayLocal } from "../lib/time.ts";

/**
 * El filtre que comparteixen tots els agregats.
 *
 * Si algun dia cal canviar que compta com a despesa, es canvia aqui i val per
 * a tots els informes alhora.
 */
function filtreBase(
  ledgerIds: number[],
  dataDes: string | null,
  dataFins: string | null,
): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    inArray(transactions.ledgerId, ledgerIds),
    isNull(transactions.transferGroupId),
    eq(transactions.isExcluded, false),
    eq(transactions.status, "booked"),
  ];
  if (dataDes !== null) parts.push(gte(transactions.bookingDate, dataDes));
  if (dataFins !== null) parts.push(lte(transactions.bookingDate, dataFins));
  return and(...parts);
}

/** Primer dia del mes i primer dia del mes següent. */
export function limitsDelMes(referencia?: string): [string, string] {
  const base = referencia ?? todayLocal();
  const any = Number(base.slice(0, 4));
  const mes = Number(base.slice(5, 7));
  const primer = `${base.slice(0, 7)}-01`;
  const seguent =
    mes === 12
      ? `${any + 1}-01-01`
      : `${any}-${String(mes + 1).padStart(2, "0")}-01`;
  return [primer, seguent];
}

export interface IngressosDespeses {
  ingressos: MoneyString;
  /** En positiu, tot i que a la base de dades son negatius. */
  despeses: MoneyString;
  net: MoneyString;
}

export async function ingressosIDespeses(
  ledgerIds: number[],
  dataDes: string | null,
  dataFins: string | null,
): Promise<IngressosDespeses> {
  if (ledgerIds.length === 0) {
    return { ingressos: "0.00", despeses: "0.00", net: "0.00" };
  }

  const [fila] = await db
    .select({
      ingressos: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      despeses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(filtreBase(ledgerIds, dataDes, dataFins));

  const ingressos = money(fila?.ingressos ?? "0");
  const despeses = money(fila?.despeses ?? "0");

  return {
    ingressos: toMoneyString(ingressos),
    despeses: toMoneyString(despeses),
    net: toMoneyString(ingressos.minus(despeses)),
  };
}

export interface PuntMensual {
  periode: string;
  ingressos: MoneyString;
  despeses: MoneyString;
  net: MoneyString;
}

/** Ingressos, despeses i resultat de cada mes. */
export async function serieMensual(
  ledgerIds: number[],
  dataDes: string,
  dataFins: string,
): Promise<PuntMensual[]> {
  if (ledgerIds.length === 0) return [];

  const periode = sql<string>`substring(${transactions.bookingDate}::text, 1, 7)`;

  const files = await db
    .select({
      periode,
      ingressos: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      despeses: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(filtreBase(ledgerIds, dataDes, dataFins))
    .groupBy(periode)
    .orderBy(periode);

  return files.map((f) => {
    const ingressos = money(f.ingressos);
    const despeses = money(f.despeses);
    return {
      periode: f.periode,
      ingressos: toMoneyString(ingressos),
      despeses: toMoneyString(despeses),
      net: toMoneyString(ingressos.minus(despeses)),
    };
  });
}

export interface TrosCategoria {
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
export async function repartimentCategories(
  ledgerIds: number[],
  dataDes: string | null,
  dataFins: string | null,
  despeses = true,
  limit = 30,
): Promise<TrosCategoria[]> {
  if (ledgerIds.length === 0) return [];

  const pare = sql`pare`;
  const grupId = sql<number | null>`coalesce(pare.id, ${categories.id})`;
  const grupNom = sql<string | null>`coalesce(pare.name, ${categories.name})`;
  const grupColor = sql<string | null>`coalesce(pare.color, ${categories.color})`;
  const total = sql<string>`sum(abs(${transactions.amount}))`;

  const files = await db
    .select({
      groupId: grupId,
      groupName: grupNom,
      color: grupColor,
      amount: total,
      transaccions: count(transactions.id),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(sql`categories as ${pare}`, sql`pare.id = ${categories.parentId}`)
    .where(
      and(
        filtreBase(ledgerIds, dataDes, dataFins),
        despeses ? sql`${transactions.amount} < 0` : sql`${transactions.amount} > 0`,
      ),
    )
    .groupBy(grupId, grupNom, grupColor)
    .orderBy(sql`sum(abs(${transactions.amount})) desc`)
    .limit(limit);

  const suma = files.reduce((acc, f) => acc.plus(money(f.amount)), new Decimal(0));

  return files.map((f) => ({
    categoryId: f.groupId,
    categoryName: f.groupName ?? "Sense classificar",
    color: f.color ?? "#94a3b8",
    amount: toMoneyString(money(f.amount)),
    share: suma.isZero() ? 0 : money(f.amount).dividedBy(suma).toNumber(),
    transactions: f.transaccions,
  }));
}

export interface TrosComerc {
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
export async function repartimentComercos(
  ledgerIds: number[],
  dataDes: string | null,
  dataFins: string | null,
  limit = 20,
): Promise<TrosComerc[]> {
  if (ledgerIds.length === 0) return [];

  const total = sql<string>`sum(abs(${transactions.amount}))`;

  const files = await db
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
        filtreBase(ledgerIds, dataDes, dataFins),
        sql`${transactions.amount} < 0`,
        isNull(transactions.displayDescription),
      ),
    )
    .groupBy(transactions.merchantId, merchants.displayName)
    .orderBy(sql`sum(abs(${transactions.amount})) desc`)
    .limit(limit);

  return files.map((f) => ({
    merchantId: f.merchantId,
    merchantName: f.merchantName ?? "—",
    amount: toMoneyString(money(f.amount)),
    transactions: f.transaccions,
  }));
}

export async function comptaPendentsRevisio(ledgerIds: number[]): Promise<number> {
  if (ledgerIds.length === 0) return 0;
  const [fila] = await db
    .select({ n: count() })
    .from(transactions)
    .where(
      and(inArray(transactions.ledgerId, ledgerIds), eq(transactions.needsReview, true)),
    );
  return fila?.n ?? 0;
}

export async function comptaSenseClassificar(ledgerIds: number[]): Promise<number> {
  if (ledgerIds.length === 0) return 0;
  const [fila] = await db
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
  return fila?.n ?? 0;
}

export { sum };
