/**
 * Deteccio de moviments recurrents i subscripcions.
 *
 * Un rebut es reconeix perque el mateix emissor apareix a intervals regulars
 * amb un import estable. A partir d'aqui es pot avisar quan puja de preu o
 * quan un mes no arriba, i sobretot es pot projectar el saldo.
 *
 * Traduccio de `backend/app/services/recurring.py`.
 */

import { and, asc, eq, gte, isNotNull, isNull } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  CADENCE_DAYS,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type Cadence,
} from "../db/schema/index.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { Decimal, money, toMoneyString } from "../lib/money.ts";
import { creaAvis } from "./alerts.ts";

/** Falta de calendari: no tots els mesos tenen els mateixos dies. */
const CADENCE_TOLERANCE_DAYS: Record<Cadence, number> = {
  weekly: 2,
  biweekly: 3,
  monthly: 6,
  bimonthly: 8,
  quarterly: 12,
  semiannual: 20,
  annual: 30,
};

const MIN_OCCURRENCES = 3;
/** Un rebut es dona per perdut quan passen aquests dies de la data prevista. */
const MISSING_GRACE_DAYS = 7;
const HISTORY_MONTHS = 18;
/** Per sota d'aquesta proporcio d'intervals regulars, no es una serie. */
const MIN_REGULARITY = 0.6;

export interface EstadistiquesRecurrents {
  creades: number;
  actualitzades: number;
  acabades: number;
  avisos: number;
}

export function resumRecurrents(s: EstadistiquesRecurrents): string {
  return `recurrents: ${s.creades} noves, ${s.actualitzades} actualitzades, ${s.acabades} finalitzades, ${s.avisos} avisos`;
}

/** Mediana d'una llista de numeros, com la de `statistics`. */
function mediana(valors: number[]): number {
  if (valors.length === 0) return 0;
  const ordenats = [...valors].sort((a, b) => a - b);
  const mig = Math.floor(ordenats.length / 2);
  if (ordenats.length % 2 === 1) return ordenats[mig] as number;
  return ((ordenats[mig - 1] as number) + (ordenats[mig] as number)) / 2;
}

/** Mediana d'imports, sense passar mai per coma flotant. */
function medianaImports(valors: string[]): Decimal {
  if (valors.length === 0) return new Decimal(0);
  const ordenats = [...valors].map((v) => new Decimal(v)).sort((a, b) => a.comparedTo(b));
  const mig = Math.floor(ordenats.length / 2);
  if (ordenats.length % 2 === 1) return ordenats[mig] as Decimal;
  return (ordenats[mig - 1] as Decimal).plus(ordenats[mig] as Decimal).dividedBy(2);
}

/** La cadencia que mes s'acosta a un interval observat, si n'hi ha cap. */
function cadenciaMesPropera(intervalDies: number): Cadence | null {
  for (const cadencia of Object.keys(CADENCE_DAYS) as Cadence[]) {
    if (Math.abs(intervalDies - CADENCE_DAYS[cadencia]) <= CADENCE_TOLERANCE_DAYS[cadencia]) {
      return cadencia;
    }
  }
  return null;
}

/** Proporcio d'intervals que encaixen amb la cadencia trobada. */
function regularitat(intervals: number[], esperat: number, tolerancia: number): number {
  if (intervals.length === 0) return 0;
  const bons = intervals.filter((v) => Math.abs(v - esperat) <= tolerancia).length;
  return bons / intervals.length;
}

interface MovimentSerie {
  id: number;
  bookingDate: string;
  amount: string;
  merchantId: number | null;
  categoryId: number | null;
  merchantNormalized: string | null;
  merchantDisplay: string | null;
  normalizedDescription: string;
  description: string;
  displayDescription: string | null;
}

/** Clau que identifica la serie: el comerç mes el sentit de l'import. */
function signatura(m: MovimentSerie): string | null {
  const base = m.merchantNormalized ?? m.normalizedDescription;
  if (!base) return null;
  const sentit = money(m.amount).isPositive() ? "in" : "out";
  return `${base}|${sentit}`.slice(0, 220);
}

function etiquetaSerie(m: MovimentSerie): string {
  if (m.displayDescription) return m.displayDescription;
  if (m.merchantDisplay) return m.merchantDisplay;
  return m.normalizedDescription || m.description.slice(0, 80);
}

/**
 * Recalcula les series recurrents d'un espai a partir del seu historic.
 */
export async function detectaRecurrents(ledgerId: number): Promise<EstadistiquesRecurrents> {
  const estadistiques: EstadistiquesRecurrents = {
    creades: 0,
    actualitzades: 0,
    acabades: 0,
    avisos: 0,
  };

  const des = addDays(todayLocal(), -HISTORY_MONTHS * 31);

  const moviments = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amount: transactions.amount,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
      merchantNormalized: merchants.normalizedName,
      merchantDisplay: merchants.displayName,
      normalizedDescription: transactions.normalizedDescription,
      description: transactions.description,
      displayDescription: transactions.displayDescription,
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        gte(transactions.bookingDate, des),
        eq(transactions.status, "booked"),
        // Els traspassos entre comptes propis no son rebuts.
        isNull(transactions.transferGroupId),
        eq(transactions.isExcluded, false),
      ),
    )
    .orderBy(asc(transactions.bookingDate));

  const grups = new Map<string, MovimentSerie[]>();
  for (const moviment of moviments) {
    const clau = signatura(moviment);
    if (clau === null) continue;
    const grup = grups.get(clau);
    if (grup) grup.push(moviment);
    else grups.set(clau, [moviment]);
  }

  for (const [clau, items] of grups) {
    await avaluaGrup(ledgerId, clau, items, estadistiques);
  }

  return estadistiques;
}

async function avaluaGrup(
  ledgerId: number,
  clau: string,
  items: MovimentSerie[],
  estadistiques: EstadistiquesRecurrents,
): Promise<void> {
  if (items.length < MIN_OCCURRENCES) return;

  const dates = items.map((i) => i.bookingDate);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const dies = daysBetween(dates[i - 1] as string, dates[i] as string);
    if (dies > 0) intervals.push(dies);
  }
  if (intervals.length === 0) return;

  const intervalMedia = mediana(intervals);
  const cadencia = cadenciaMesPropera(intervalMedia);
  if (cadencia === null) return;

  const tolerancia = CADENCE_TOLERANCE_DAYS[cadencia];
  const regular = regularitat(intervals, CADENCE_DAYS[cadencia], tolerancia);
  if (regular < MIN_REGULARITY) return;

  const importEsperat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
  // Tolerancia d'import: un 10%, amb un minim d'un euro per als rebuts petits.
  const toleranciaImport = Decimal.max(
    importEsperat.abs().times("0.10"),
    new Decimal("1.00"),
  ).toDecimalPlaces(2);

  const confianca =
    Math.round(Math.min(1, regular * Math.min(1, items.length / 6)) * 100) / 100;
  const ultimaData = dates[dates.length - 1] as string;
  const intervalArrodonit = Math.round(intervalMedia);
  const seguentPrevista = addDays(ultimaData, intervalArrodonit);
  const ultim = items[items.length - 1] as MovimentSerie;

  const [existent] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.ledgerId, ledgerId), eq(recurringSeries.signature, clau)))
    .limit(1);

  let serieId: number;

  if (!existent) {
    const [creada] = await db
      .insert(recurringSeries)
      .values({
        ledgerId,
        signature: clau,
        label: etiquetaSerie(ultim),
        merchantId: ultim.merchantId,
        categoryId: ultim.categoryId,
        cadence: cadencia,
        expectedAmount: toMoneyString(importEsperat),
        amountTolerance: toMoneyString(toleranciaImport),
        intervalDays: intervalArrodonit,
        confidence: confianca,
        occurrencesCount: items.length,
        firstSeenDate: dates[0] as string,
        lastSeenDate: ultimaData,
        nextExpectedDate: seguentPrevista,
        // Nomes es diu «subscripcio» si es mensual i surt diners.
        isSubscription: cadencia === "monthly" && money(ultim.amount).isNegative(),
        status: "active",
        includeInForecast: true,
      })
      .returning({ id: recurringSeries.id });

    if (!creada) return;
    serieId = creada.id;
    estadistiques.creades += 1;
  } else {
    serieId = existent.id;
    const importAnterior = money(existent.expectedAmount);

    await db
      .update(recurringSeries)
      .set({
        cadence: cadencia,
        intervalDays: intervalArrodonit,
        confidence: confianca,
        occurrencesCount: items.length,
        lastSeenDate: ultimaData,
        nextExpectedDate: seguentPrevista,
        categoryId: ultim.categoryId ?? existent.categoryId,
        merchantId: ultim.merchantId ?? existent.merchantId,
        status: "active",
        expectedAmount: toMoneyString(importEsperat),
        amountTolerance: toMoneyString(toleranciaImport),
        ...(ultim.displayDescription ? { label: ultim.displayDescription } : {}),
      })
      .where(eq(recurringSeries.id, serieId));

    estadistiques.actualitzades += 1;

    // Si l'ultim rebut s'aparta del que era habitual, val la pena dir-ho.
    if (money(ultim.amount).minus(importAnterior).abs().gt(money(existent.amountTolerance))) {
      const puja = money(ultim.amount).abs().gt(importAnterior.abs());
      const creat = await creaAvis({
        type: "recurring_amount_change",
        ledgerId,
        dedupKey: `amount-change:${serieId}:${ultimaData}`,
        title: `${existent.label}: l'import ${puja ? "puja" : "baixa"} a ${money(ultim.amount).abs().toFixed(2)} EUR`,
        body: `L'import habitual era de ${importAnterior.abs().toFixed(2)} EUR i l'ultim rebut ha estat de ${money(ultim.amount).abs().toFixed(2)} EUR.`,
        severity: "warning",
        payload: {
          series_id: serieId,
          previous_amount: existent.expectedAmount,
          new_amount: ultim.amount,
          transaction_id: ultim.id,
        },
      });
      if (creat) estadistiques.avisos += 1;
    }
  }

  await enllacaAparicions(serieId, items);
}

async function enllacaAparicions(serieId: number, items: MovimentSerie[]): Promise<void> {
  const conegudes = new Set(
    (
      await db
        .select({ transactionId: recurringOccurrences.transactionId })
        .from(recurringOccurrences)
        .where(eq(recurringOccurrences.seriesId, serieId))
    ).map((o) => o.transactionId),
  );

  const noves = items
    .filter((i) => !conegudes.has(i.id))
    .map((i) => ({
      seriesId: serieId,
      transactionId: i.id,
      occurredOn: i.bookingDate,
      amount: i.amount,
    }));

  if (noves.length > 0) {
    await db.insert(recurringOccurrences).values(noves).onConflictDoNothing();
  }
}

/**
 * Avisa dels rebuts que no han arribat quan tocava.
 *
 * Passat mes d'un periode sencer sense saber-ne res, la serie es dona per
 * acabada en lloc d'anar avisant per sempre.
 */
export async function comprovaRebutsQueFalten(ledgerId: number): Promise<number> {
  const avui = todayLocal();
  let creats = 0;

  const series = await db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        isNotNull(recurringSeries.nextExpectedDate),
      ),
    );

  for (const serie of series) {
    const prevista = serie.nextExpectedDate;
    if (prevista === null) continue;

    const diesDeRetard = daysBetween(prevista, avui);
    if (diesDeRetard < MISSING_GRACE_DAYS) continue;

    if (diesDeRetard > serie.intervalDays + MISSING_GRACE_DAYS) {
      await db
        .update(recurringSeries)
        .set({ status: "ended" })
        .where(eq(recurringSeries.id, serie.id));
      continue;
    }

    const creat = await creaAvis({
      type: "recurring_missing",
      ledgerId,
      dedupKey: `missing:${serie.id}:${prevista}`,
      title: `${serie.label}: no ha arribat el rebut previst`,
      body: `S'esperava un import aproximat de ${money(serie.expectedAmount).abs().toFixed(2)} EUR i encara no consta.`,
      severity: "info",
      payload: { series_id: serie.id, expected_date: prevista },
    });
    if (creat) creats += 1;
  }

  return creats;
}

/** Cost mensual d'una serie: l'import repartit segons el seu interval. */
export function costMensual(expectedAmount: string, intervalDays: number): Decimal {
  return money(expectedAmount)
    .times(30)
    .dividedBy(intervalDays || 30);
}
