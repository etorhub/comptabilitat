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

import { movimentsComptables } from "./filtres.ts";
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
import { creaAvis } from "./alerts.ts";
import { categoriaDeLespai } from "./categories.ts";

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

export interface EstadistiquesRecurrents {
  creades: number;
  actualitzades: number;
  acabades: number;
  avisos: number;
}

export function resumRecurrents(s: EstadistiquesRecurrents): string {
  return `recurrents: ${s.creades} noves, ${s.actualitzades} actualitzades, ${s.acabades} finalitzades, ${s.avisos} avisos`;
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

function cadenciaMesPropera(intervalDies: number): Cadence | null {
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

interface MovimentSerie {
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

function signatura(m: MovimentSerie): string {
  const contrapart = m.merchantId !== null ? `m${m.merchantId}` : "-";
  const sentit = money(m.amount).isPositive() ? "in" : "out";
  return `c${m.categoryId}|${contrapart}|${sentit}`;
}

function etiquetaSerie(m: MovimentSerie): string {
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
      and(movimentsComptables({ espais: ledgerId, des }), isNotNull(transactions.categoryId)),
    )
    .orderBy(asc(transactions.bookingDate));

  const grups = new Map<string, MovimentSerie[]>();
  for (const moviment of moviments) {
    if (moviment.categoryId === null) continue;
    const fila: MovimentSerie = { ...moviment, categoryId: moviment.categoryId };
    const clau = signatura(fila);
    const grup = grups.get(clau);
    if (grup) grup.push(fila);
    else grups.set(clau, [fila]);
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
  const [existent] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.ledgerId, ledgerId), eq(recurringSeries.signature, clau)))
    .limit(1);

  if (existent && (existent.status === "dismissed" || existent.status === "ended")) {
    return;
  }

  const dates = items.map((i) => i.bookingDate);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const dies = daysBetween(dates[i - 1] as string, dates[i] as string);
    if (dies > 0) intervals.push(dies);
  }

  // Serie activa: refresca amb la cadencia que ja te (no cal re-detectar).
  if (existent?.status === "active") {
    const intervalArrodonit = existent.intervalDays;
    const ultimaData = dates[dates.length - 1] as string;
    const ultim = items[items.length - 1] as MovimentSerie;
    const importDetectat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
    const importEsperat =
      existent.amountMode === "average"
        ? medianaImports(importsRecents(items)).toDecimalPlaces(2)
        : money(existent.expectedAmount);

    await db
      .update(recurringSeries)
      .set({
        occurrencesCount: items.length,
        lastSeenDate: ultimaData,
        nextExpectedDate: addDays(ultimaData, intervalArrodonit),
        merchantId: ultim.merchantId,
        ...(existent.amountMode === "average"
          ? {
              expectedAmount: toMoneyString(importEsperat),
              amountTolerance: toMoneyString(toleranciaDimport(importEsperat)),
            }
          : {}),
        ...(ultim.displayDescription ? { label: ultim.displayDescription } : {}),
      })
      .where(eq(recurringSeries.id, existent.id));

    estadistiques.actualitzades += 1;

    if (
      existent.amountMode === "exact" &&
      money(ultim.amount)
        .minus(money(existent.expectedAmount))
        .abs()
        .gt(money(existent.amountTolerance))
    ) {
      const puja = money(ultim.amount).abs().gt(money(existent.expectedAmount).abs());
      const creat = await creaAvis({
        type: "recurring_amount_change",
        ledgerId,
        dedupKey: `amount-change:${existent.id}:${ultimaData}`,
        title: `${existent.label}: l'import ${puja ? "puja" : "baixa"} a ${money(ultim.amount).abs().toFixed(2)} EUR`,
        body: `L'import habitual era de ${money(existent.expectedAmount).abs().toFixed(2)} EUR i l'ultim rebut ha estat de ${money(ultim.amount).abs().toFixed(2)} EUR.`,
        severity: "warning",
        payload: {
          series_id: existent.id,
          previous_amount: existent.expectedAmount,
          new_amount: ultim.amount,
          transaction_id: ultim.id,
        },
      });
      if (creat) estadistiques.avisos += 1;
    }

    // Si l'import detectat divergeix molt amb average, no cal avis: ja es refresca.
    void importDetectat;
    await enllacaAparicions(existent.id, items);
    return;
  }

  // Suggested nova o existent: cal patro minim.
  if (items.length < MIN_OCCURRENCES) return;
  if (intervals.length === 0) return;

  const intervalMedia = mediana(intervals);
  const trobada = cadenciaMesPropera(intervalMedia);
  if (trobada === null) return;

  const tolerancia = CADENCE_TOLERANCE_DAYS[trobada];
  const regular = regularitat(intervals, CADENCE_DAYS[trobada], tolerancia);
  if (regular < MIN_REGULARITY) return;

  const cadencia = trobada;
  const intervalArrodonit = Math.round(intervalMedia);
  const confianca =
    Math.round(Math.min(1, regular * Math.min(1, items.length / 6)) * 100) / 100;
  const importEsperat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
  const toleranciaImport = toleranciaDimport(importEsperat);
  const ultimaData = dates[dates.length - 1] as string;
  const seguentPrevista = addDays(ultimaData, intervalArrodonit);
  const ultim = items[items.length - 1] as MovimentSerie;

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
        amountMode: "exact",
        intervalDays: intervalArrodonit,
        confidence: confianca,
        occurrencesCount: items.length,
        firstSeenDate: dates[0] as string,
        lastSeenDate: ultimaData,
        nextExpectedDate: seguentPrevista,
        status: "suggested",
        includeInForecast: false,
      })
      .returning({ id: recurringSeries.id });

    if (!creada) return;
    estadistiques.creades += 1;
    await enllacaAparicions(creada.id, items);
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
      lastSeenDate: ultimaData,
      nextExpectedDate: seguentPrevista,
      merchantId: ultim.merchantId,
      expectedAmount: toMoneyString(importEsperat),
      amountTolerance: toMoneyString(toleranciaImport),
      ...(ultim.displayDescription ? { label: ultim.displayDescription } : {}),
    })
    .where(eq(recurringSeries.id, existent.id));

  estadistiques.actualitzades += 1;
  await enllacaAparicions(existent.id, items);
}

function importsRecents(items: MovimentSerie[]): string[] {
  const des = addDays(todayLocal(), -AVERAGE_MONTHS * 31);
  const recents = items.filter((i) => i.bookingDate >= des).map((i) => i.amount);
  return recents.length > 0 ? recents : items.map((i) => i.amount);
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
 * Confirma una proposta: passa a activa i entra a la previsio.
 */
export async function confirmaSerie(
  serieId: number,
  opcions: { cadence: Cadence; amountMode: AmountMode },
  connexio: Transactor = db,
): Promise<void> {
  await connexio
    .update(recurringSeries)
    .set({
      status: "active",
      includeInForecast: true,
      cadence: opcions.cadence,
      intervalDays: CADENCE_DAYS[opcions.cadence],
      amountMode: opcions.amountMode,
      confidence: 1,
    })
    .where(eq(recurringSeries.id, serieId));
}

/** Descarta una serie: el detector ja no la tornarà a crear (mateixa signatura). */
export async function descartaSerie(serieId: number, connexio: Transactor = db): Promise<void> {
  await connexio
    .update(recurringSeries)
    .set({ status: "dismissed", includeInForecast: false })
    .where(eq(recurringSeries.id, serieId));
}

export interface DadesSerieManual {
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
export async function creaSerieManual(
  ledgerId: number,
  dades: DadesSerieManual,
  connexio: Transactor = db,
): Promise<number> {
  await categoriaDeLespai(dades.categoryId, ledgerId);

  const importEsperat = money(dades.expectedAmount);
  if (importEsperat.isZero()) {
    throw new ConflictError("L'import no pot ser zero");
  }

  const merchantId = dades.merchantId ?? null;
  const signature = signaturaManual(dades.categoryId, merchantId, dades.expectedAmount);
  const intervalDays = CADENCE_DAYS[dades.cadence];
  const amount = toMoneyString(importEsperat);
  const amountTolerance = toMoneyString(toleranciaDimport(importEsperat));
  const dia = dades.nextExpectedDate;

  const [existent] = await connexio
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

    await connexio
      .update(recurringSeries)
      .set({
        label: dades.label,
        merchantId,
        categoryId: dades.categoryId,
        cadence: dades.cadence,
        expectedAmount: amount,
        amountTolerance,
        amountMode: "exact",
        intervalDays,
        confidence: 1,
        occurrencesCount: 0,
        firstSeenDate: dia,
        lastSeenDate: dia,
        nextExpectedDate: dia,
        status: "active",
        includeInForecast: true,
      })
      .where(eq(recurringSeries.id, existent.id));

    return existent.id;
  }

  const [creada] = await connexio
    .insert(recurringSeries)
    .values({
      ledgerId,
      signature,
      label: dades.label,
      merchantId,
      categoryId: dades.categoryId,
      cadence: dades.cadence,
      expectedAmount: amount,
      amountTolerance,
      amountMode: "exact",
      intervalDays,
      confidence: 1,
      occurrencesCount: 0,
      firstSeenDate: dia,
      lastSeenDate: dia,
      nextExpectedDate: dia,
      status: "active",
      includeInForecast: true,
    })
    .returning({ id: recurringSeries.id });

  if (!creada) throw new ConflictError("No s'ha pogut crear la serie");
  return creada.id;
}

/** Canvia l'import esperat i el deixa fix perquè el detector no l'escrigui. */
export async function actualitzaImportSerie(
  serieId: number,
  expectedAmount: MoneyString,
  connexio: Transactor = db,
): Promise<void> {
  const importEsperat = money(expectedAmount);
  if (importEsperat.isZero()) {
    throw new ConflictError("L'import no pot ser zero");
  }

  await connexio
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
export async function comprovaRebutsQueFalten(ledgerId: number): Promise<number> {
  const avui = todayLocal();
  let creats = 0;

  const series = await db
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

  for (const serie of series) {
    const prevista = serie.nextExpectedDate;
    if (prevista === null) continue;

    const diesDeRetard = daysBetween(prevista, avui);
    if (diesDeRetard < MISSING_GRACE_DAYS) continue;

    if (diesDeRetard > serie.intervalDays + MISSING_GRACE_DAYS) {
      // Exactes confirmades es queden actives; les de mitjana poden acabar-se.
      if (serie.amountMode === "exact") continue;

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
