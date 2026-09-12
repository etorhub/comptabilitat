/**
 * Deteccio de rebuts previstos (schedules).
 *
 * El detector mira l'historic categoritzat i **nomes proposa** series
 * (`status: suggested`). La persona les confirma o les descarta a
 * `/recurrents`. La previsio nomes mira les `active` amb
 * `include_in_forecast`.
 *
 * Agrupa per categoria + comerç + sentit. Calen ≥3 aparicions a intervals
 * regulars (o ja una serie activa/suggested existent que es refresca).
 */

import { and, asc, eq, isNotNull } from "drizzle-orm";

import { countableTransactions } from "./filtres.ts";
import { db, type Transactor } from "../db/client.ts";
import {
  CADENCE_DAYS,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type AmountMode,
  type Cadence,
} from "../db/schema/index.ts";
import { ConflictError } from "../lib/http.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { createAlert } from "./alerts.ts";
import { categoryInWorkspace } from "./categories.ts";

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
const MISSING_GRACE_DAYS = 7;
const HISTORY_MONTHS = 18;
const MIN_REGULARITY = 0.6;
/** Finestres per a `amount_mode: average`. */
const AVERAGE_MONTHS = 6;

export interface RecurringStats {
  creades: number;
  actualitzades: number;
  acabades: number;
  alertList: number;
}

export function summaryRecurring(s: RecurringStats): string {
  return `recurrents: ${s.creades} noves, ${s.actualitzades} actualitzades, ${s.acabades} finalitzades, ${s.alertList} avisos`;
}

function mediana(valors: number[]): number {
  if (valors.length === 0) return 0;
  const ordenats = valors.toSorted((a, b) => a - b);
  const mig = Math.floor(ordenats.length / 2);
  if (ordenats.length % 2 === 1) return ordenats[mig] as number;
  return ((ordenats[mig - 1] as number) + (ordenats[mig] as number)) / 2;
}

function medianaImports(valors: string[]): Decimal {
  if (valors.length === 0) return new Decimal(0);
  const ordenats = valors.map((v) => new Decimal(v)).toSorted((a, b) => a.comparedTo(b));
  const mig = Math.floor(ordenats.length / 2);
  if (ordenats.length % 2 === 1) return ordenats[mig] as Decimal;
  return (ordenats[mig - 1] as Decimal).plus(ordenats[mig] as Decimal).dividedBy(2);
}

function nextCadenceMonth(intervalDies: number): Cadence | null {
  for (const cadencia of Object.keys(CADENCE_DAYS) as Cadence[]) {
    if (Math.abs(intervalDies - CADENCE_DAYS[cadencia]) <= CADENCE_TOLERANCE_DAYS[cadencia]) {
      return cadencia;
    }
  }
  return null;
}

function regularitat(intervals: number[], esperat: number, tolerancia: number): number {
  if (intervals.length === 0) return 0;
  const bons = intervals.filter((v) => Math.abs(v - esperat) <= tolerancia).length;
  return bons / intervals.length;
}

interface TransactionSeries {
  id: number;
  bookingDate: string;
  amount: string;
  categoryId: number;
  merchantId: number | null;
  merchantDisplay: string | null;
  normalizedDescription: string;
  description: string;
  displayDescription: string | null;
}

function signatura(m: TransactionSeries): string {
  const counterparty = m.merchantId !== null ? `m${m.merchantId}` : "-";
  const sentit = money(m.amount).isPositive() ? "in" : "out";
  return `c${m.categoryId}|${counterparty}|${sentit}`;
}

function seriesLabel(m: TransactionSeries): string {
  if (m.displayDescription) return m.displayDescription;
  if (m.merchantDisplay) return m.merchantDisplay;
  return m.normalizedDescription || m.description.slice(0, 80);
}

function toleranciaDimport(importEsperat: Decimal): Decimal {
  return Decimal.max(importEsperat.abs().times("0.10"), new Decimal("1.00")).toDecimalPlaces(2);
}

/**
 * Proposa o refresca series a partir de l'historic categoritzat.
 *
 * - Nova serie → `suggested`, fora de la previsio fins que es confirmi.
 * - `suggested` existent → refresca cadencia/import/dates.
 * - `active` → refresca dates i aparicions; l'import nomes si `average`.
 * - `dismissed` / `ended` → no es toca.
 */
export async function detectRecurring(ledgerId: number): Promise<RecurringStats> {
  const stats: RecurringStats = {
    creades: 0,
    actualitzades: 0,
    acabades: 0,
    alertList: 0,
  };

  const des = addDays(todayLocal(), -HISTORY_MONTHS * 31);

  const transactionList = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      merchantId: transactions.merchantId,
      merchantDisplay: merchants.displayName,
      normalizedDescription: transactions.normalizedDescription,
      description: transactions.description,
      displayDescription: transactions.displayDescription,
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        countableTransactions({ workspaces: ledgerId, des }),
        isNotNull(transactions.categoryId),
      ),
    )
    .orderBy(asc(transactions.bookingDate));

  const groups = new Map<string, TransactionSeries[]>();
  for (const transaction of transactionList) {
    if (transaction.categoryId === null) continue;
    const row: TransactionSeries = { ...transaction, categoryId: transaction.categoryId };
    const key = signatura(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const [key, items] of groups) {
    await evaluateGroup(ledgerId, key, items, stats);
  }

  return stats;
}

async function evaluateGroup(
  ledgerId: number,
  key: string,
  items: TransactionSeries[],
  stats: RecurringStats,
): Promise<void> {
  const [existent] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.ledgerId, ledgerId), eq(recurringSeries.signature, key)))
    .limit(1);

  if (existent && (existent.status === "dismissed" || existent.status === "ended")) {
    return;
  }

  const dates = items.map((i) => i.bookingDate);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const days = daysBetween(dates[i - 1] as string, dates[i] as string);
    if (days > 0) intervals.push(days);
  }

  // Serie activa: refresca amb la cadencia que ja te (no cal re-detectar).
  if (existent?.status === "active") {
    const intervalArrodonit = existent.intervalDays;
    const lastDate = dates[dates.length - 1] as string;
    const last = items[items.length - 1] as TransactionSeries;
    const importDetectat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
    const importEsperat =
      existent.amountMode === "average"
        ? medianaImports(importsRecents(items)).toDecimalPlaces(2)
        : money(existent.expectedAmount);

    await db
      .update(recurringSeries)
      .set({
        occurrencesCount: items.length,
        lastSeenDate: lastDate,
        nextExpectedDate: addDays(lastDate, intervalArrodonit),
        merchantId: last.merchantId,
        ...(existent.amountMode === "average"
          ? {
              expectedAmount: toMoneyString(importEsperat),
              amountTolerance: toMoneyString(toleranciaDimport(importEsperat)),
            }
          : {}),
        ...(last.displayDescription ? { label: last.displayDescription } : {}),
      })
      .where(eq(recurringSeries.id, existent.id));

    stats.actualitzades += 1;

    if (
      existent.amountMode === "exact" &&
      money(last.amount)
        .minus(money(existent.expectedAmount))
        .abs()
        .gt(money(existent.amountTolerance))
    ) {
      const puja = money(last.amount).abs().gt(money(existent.expectedAmount).abs());
      const creat = await createAlert({
        type: "recurring_amount_change",
        ledgerId,
        dedupKey: `amount-change:${existent.id}:${lastDate}`,
        title: `${existent.label}: l'import ${puja ? "puja" : "baixa"} a ${money(last.amount).abs().toFixed(2)} EUR`,
        body: `L'import habitual era de ${money(existent.expectedAmount).abs().toFixed(2)} EUR i l'ultim rebut ha estat de ${money(last.amount).abs().toFixed(2)} EUR.`,
        severity: "warning",
        payload: {
          series_id: existent.id,
          previous_amount: existent.expectedAmount,
          new_amount: last.amount,
          transaction_id: last.id,
        },
      });
      if (creat) stats.alertList += 1;
    }

    // Si l'import detectat divergeix molt amb average, no cal avis: ja es refresca.
    void importDetectat;
    await linkOccurrences(existent.id, items);
    return;
  }

  // Suggested nova o existent: cal patro minim.
  if (items.length < MIN_OCCURRENCES) return;
  if (intervals.length === 0) return;

  const intervalMedia = mediana(intervals);
  const found = nextCadenceMonth(intervalMedia);
  if (found === null) return;

  const tolerancia = CADENCE_TOLERANCE_DAYS[found];
  const regular = regularitat(intervals, CADENCE_DAYS[found], tolerancia);
  if (regular < MIN_REGULARITY) return;

  const cadencia = found;
  const intervalArrodonit = Math.round(intervalMedia);
  const confianca =
    Math.round(Math.min(1, regular * Math.min(1, items.length / 6)) * 100) / 100;
  const importEsperat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
  const toleranciaImport = toleranciaDimport(importEsperat);
  const lastDate = dates[dates.length - 1] as string;
  const nextExpected = addDays(lastDate, intervalArrodonit);
  const last = items[items.length - 1] as TransactionSeries;

  if (!existent) {
    const [creada] = await db
      .insert(recurringSeries)
      .values({
        ledgerId,
        signature: key,
        label: seriesLabel(last),
        merchantId: last.merchantId,
        categoryId: last.categoryId,
        cadence: cadencia,
        expectedAmount: toMoneyString(importEsperat),
        amountTolerance: toMoneyString(toleranciaImport),
        amountMode: "exact",
        intervalDays: intervalArrodonit,
        confidence: confianca,
        occurrencesCount: items.length,
        firstSeenDate: dates[0] as string,
        lastSeenDate: lastDate,
        nextExpectedDate: nextExpected,
        status: "suggested",
        includeInForecast: false,
      })
      .returning({ id: recurringSeries.id });

    if (!creada) return;
    stats.creades += 1;
    await linkOccurrences(creada.id, items);
    return;
  }

  // suggested existent
  await db
    .update(recurringSeries)
    .set({
      cadence: cadencia,
      intervalDays: intervalArrodonit,
      confidence: confianca,
      occurrencesCount: items.length,
      lastSeenDate: lastDate,
      nextExpectedDate: nextExpected,
      merchantId: last.merchantId,
      expectedAmount: toMoneyString(importEsperat),
      amountTolerance: toMoneyString(toleranciaImport),
      ...(last.displayDescription ? { label: last.displayDescription } : {}),
    })
    .where(eq(recurringSeries.id, existent.id));

  stats.actualitzades += 1;
  await linkOccurrences(existent.id, items);
}

function importsRecents(items: TransactionSeries[]): string[] {
  const des = addDays(todayLocal(), -AVERAGE_MONTHS * 31);
  const recents = items.filter((i) => i.bookingDate >= des).map((i) => i.amount);
  return recents.length > 0 ? recents : items.map((i) => i.amount);
}

async function linkOccurrences(serieId: number, items: TransactionSeries[]): Promise<void> {
  const known = new Set(
    (
      await db
        .select({ transactionId: recurringOccurrences.transactionId })
        .from(recurringOccurrences)
        .where(eq(recurringOccurrences.seriesId, serieId))
    ).map((o) => o.transactionId),
  );

  const noves = items
    .filter((i) => !known.has(i.id))
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
 * Confirma una proposta: passa a activa i entra a la previsio.
 */
export async function confirmSeries(
  serieId: number,
  options: { cadence: Cadence; amountMode: AmountMode },
  connection: Transactor = db,
): Promise<void> {
  await connection
    .update(recurringSeries)
    .set({
      status: "active",
      includeInForecast: true,
      cadence: options.cadence,
      intervalDays: CADENCE_DAYS[options.cadence],
      amountMode: options.amountMode,
      confidence: 1,
    })
    .where(eq(recurringSeries.id, serieId));
}

/** Descarta una serie: el detector ja no la tornarà a crear (mateixa signatura). */
export async function dismissSeries(
  serieId: number,
  connection: Transactor = db,
): Promise<void> {
  await connection
    .update(recurringSeries)
    .set({ status: "dismissed", includeInForecast: false })
    .where(eq(recurringSeries.id, serieId));
}

export interface ManualSeriesData {
  label: string;
  categoryId: number;
  merchantId?: number | null;
  cadence: Cadence;
  /** Amb signe: positiu = ingrés, negatiu = despesa. */
  expectedAmount: MoneyString;
  nextExpectedDate: string;
}

function signaturaManual(
  categoryId: number,
  merchantId: number | null,
  expectedAmount: MoneyString,
): string {
  return signatura({
    id: 0,
    bookingDate: "",
    amount: expectedAmount,
    categoryId,
    merchantId,
    merchantDisplay: null,
    normalizedDescription: "",
    description: "",
    displayDescription: null,
  });
}

/**
 * Crea una serie activa a ma (o reviu una de descartada amb la mateixa
 * signatura). Si ja n'hi ha una d'activa o suggerida, 409.
 */
export async function createSeriesManual(
  ledgerId: number,
  data: ManualSeriesData,
  connection: Transactor = db,
): Promise<number> {
  await categoryInWorkspace(data.categoryId, ledgerId);

  const importEsperat = money(data.expectedAmount);
  if (importEsperat.isZero()) {
    throw new ConflictError("L'import no pot ser zero");
  }

  const merchantId = data.merchantId ?? null;
  const signature = signaturaManual(data.categoryId, merchantId, data.expectedAmount);
  const intervalDays = CADENCE_DAYS[data.cadence];
  const amount = toMoneyString(importEsperat);
  const amountTolerance = toMoneyString(toleranciaDimport(importEsperat));
  const day = data.nextExpectedDate;

  const [existent] = await connection
    .select()
    .from(recurringSeries)
    .where(
      and(eq(recurringSeries.ledgerId, ledgerId), eq(recurringSeries.signature, signature)),
    )
    .limit(1);

  if (existent) {
    if (existent.status !== "dismissed") {
      throw new ConflictError("Ja hi ha una serie amb la mateixa categoria, comerç i sentit");
    }

    await connection
      .update(recurringSeries)
      .set({
        label: data.label,
        merchantId,
        categoryId: data.categoryId,
        cadence: data.cadence,
        expectedAmount: amount,
        amountTolerance,
        amountMode: "exact",
        intervalDays,
        confidence: 1,
        occurrencesCount: 0,
        firstSeenDate: day,
        lastSeenDate: day,
        nextExpectedDate: day,
        status: "active",
        includeInForecast: true,
      })
      .where(eq(recurringSeries.id, existent.id));

    return existent.id;
  }

  const [creada] = await connection
    .insert(recurringSeries)
    .values({
      ledgerId,
      signature,
      label: data.label,
      merchantId,
      categoryId: data.categoryId,
      cadence: data.cadence,
      expectedAmount: amount,
      amountTolerance,
      amountMode: "exact",
      intervalDays,
      confidence: 1,
      occurrencesCount: 0,
      firstSeenDate: day,
      lastSeenDate: day,
      nextExpectedDate: day,
      status: "active",
      includeInForecast: true,
    })
    .returning({ id: recurringSeries.id });

  if (!creada) throw new ConflictError("No s'ha pogut crear la serie");
  return creada.id;
}

/** Canvia l'import esperat i el deixa fix perquè el detector no l'escrigui. */
export async function updateSeriesAmount(
  serieId: number,
  expectedAmount: MoneyString,
  connection: Transactor = db,
): Promise<void> {
  const importEsperat = money(expectedAmount);
  if (importEsperat.isZero()) {
    throw new ConflictError("L'import no pot ser zero");
  }

  await connection
    .update(recurringSeries)
    .set({
      expectedAmount: toMoneyString(importEsperat),
      amountTolerance: toMoneyString(toleranciaDimport(importEsperat)),
      amountMode: "exact",
    })
    .where(eq(recurringSeries.id, serieId));
}

/**
 * Avisa dels rebuts actius que no han arribat quan tocava.
 *
 * Passat mes d'un periode sencer sense saber-ne res, la serie es dona per
 * acabada. Les confirmades amb `amount_mode: exact` **no** s'acaben soles
 * (la persona les vol a la previsio); nomes avisen.
 */
export async function checkMissingBills(ledgerId: number): Promise<number> {
  const today = todayLocal();
  let created = 0;

  const dueSeries = await db
    .select({
      id: recurringSeries.id,
      label: recurringSeries.label,
      nextExpectedDate: recurringSeries.nextExpectedDate,
      intervalDays: recurringSeries.intervalDays,
      expectedAmount: recurringSeries.expectedAmount,
      amountMode: recurringSeries.amountMode,
    })
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        isNotNull(recurringSeries.nextExpectedDate),
      ),
    );

  for (const series of dueSeries) {
    const expected = series.nextExpectedDate;
    if (expected === null) continue;

    const daysLate = daysBetween(expected, today);
    if (daysLate < MISSING_GRACE_DAYS) continue;

    if (daysLate > series.intervalDays + MISSING_GRACE_DAYS) {
      // Exactes confirmades es queden actives; les de mitjana poden acabar-se.
      if (series.amountMode === "exact") continue;

      await db
        .update(recurringSeries)
        .set({ status: "ended" })
        .where(eq(recurringSeries.id, series.id));
      continue;
    }

    const creat = await createAlert({
      type: "recurring_missing",
      ledgerId,
      dedupKey: `missing:${series.id}:${expected}`,
      title: `${series.label}: no ha arribat el rebut previst`,
      body: `S'esperava un import aproximat de ${money(series.expectedAmount).abs().toFixed(2)} EUR i encara no consta.`,
      severity: "info",
      payload: { series_id: series.id, expected_date: expected },
    });
    if (creat) created += 1;
  }

  return created;
}

/** Cost mensual d'una serie: l'import repartit segons el seu interval. */
export function monthlyCost(expectedAmount: string, intervalDays: number): Decimal {
  return money(expectedAmount)
    .times(30)
    .dividedBy(intervalDays || 30);
}
