/**
 * Deteccio de moviments recurrents i subscripcions.
 *
 * Un rebut es reconeix perque el mateix emissor apareix a intervals regulars
 * amb un import estable. A partir d'aqui es pot avisar quan puja de preu o
 * quan un mes no arriba, i sobretot es pot projectar el saldo.
 *
 * A mes, un comerç es pot **declarar** recurrent a ma: aleshores es crea o
 * manté una serie sense esperar les tres aparicions regulars del detector.
 *
 * Traduccio de `backend/app/services/recurring.py`.
 */

import { and, asc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  CADENCE_DAYS,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type Cadence,
} from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";
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
  const ordenats = valors.toSorted((a, b) => a - b);
  const mig = Math.floor(ordenats.length / 2);
  if (ordenats.length % 2 === 1) return ordenats[mig] as number;
  return ((ordenats[mig - 1] as number) + (ordenats[mig] as number)) / 2;
}

/** Mediana d'imports, sense passar mai per coma flotant. */
function medianaImports(valors: string[]): Decimal {
  if (valors.length === 0) return new Decimal(0);
  const ordenats = valors.map((v) => new Decimal(v)).toSorted((a, b) => a.comparedTo(b));
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

interface ComercRecurrent {
  cadence: Cadence;
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

function toleranciaDimport(importEsperat: Decimal): Decimal {
  return Decimal.max(importEsperat.abs().times("0.10"), new Decimal("1.00")).toDecimalPlaces(2);
}

/**
 * Intenta endevinar la cadencia a partir dels intervals observats; si no n'hi
 * ha prou, torna `monthly`.
 */
export function inferCadencia(dates: string[]): Cadence {
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const dies = daysBetween(dates[i - 1] as string, dates[i] as string);
    if (dies > 0) intervals.push(dies);
  }
  if (intervals.length === 0) return "monthly";
  return cadenciaMesPropera(mediana(intervals)) ?? "monthly";
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

  const [moviments, declarats] = await Promise.all([
    db
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
      .orderBy(asc(transactions.bookingDate)),
    db
      .select({
        id: merchants.id,
        recurrentCadence: merchants.recurrentCadence,
      })
      .from(merchants)
      .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.isRecurrent, true))),
  ]);

  const perComerc = new Map<number, ComercRecurrent>();
  for (const c of declarats) {
    if (c.recurrentCadence) perComerc.set(c.id, { cadence: c.recurrentCadence });
  }

  const grups = new Map<string, MovimentSerie[]>();
  for (const moviment of moviments) {
    const clau = signatura(moviment);
    if (clau === null) continue;
    const grup = grups.get(clau);
    if (grup) grup.push(moviment);
    else grups.set(clau, [moviment]);
  }

  for (const [clau, items] of grups) {
    const merchantId = items.find((i) => i.merchantId !== null)?.merchantId ?? null;
    const declarat = merchantId !== null ? (perComerc.get(merchantId) ?? null) : null;
    await avaluaGrup(ledgerId, clau, items, estadistiques, declarat);
  }

  return estadistiques;
}

async function avaluaGrup(
  ledgerId: number,
  clau: string,
  items: MovimentSerie[],
  estadistiques: EstadistiquesRecurrents,
  declarat: ComercRecurrent | null,
): Promise<void> {
  const dates = items.map((i) => i.bookingDate);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const dies = daysBetween(dates[i - 1] as string, dates[i] as string);
    if (dies > 0) intervals.push(dies);
  }

  let cadencia: Cadence;
  let intervalArrodonit: number;
  let confianca: number;

  if (declarat) {
    // El comerç s'ha marcat a ma: no calen tres aparicions ni regularitat.
    if (items.length < 1) return;
    cadencia = declarat.cadence;
    intervalArrodonit = CADENCE_DAYS[cadencia];
    confianca = 1;
  } else {
    if (items.length < MIN_OCCURRENCES) return;
    if (intervals.length === 0) return;

    const intervalMedia = mediana(intervals);
    const trobada = cadenciaMesPropera(intervalMedia);
    if (trobada === null) return;

    const tolerancia = CADENCE_TOLERANCE_DAYS[trobada];
    const regular = regularitat(intervals, CADENCE_DAYS[trobada], tolerancia);
    if (regular < MIN_REGULARITY) return;

    cadencia = trobada;
    intervalArrodonit = Math.round(intervalMedia);
    confianca =
      Math.round(Math.min(1, regular * Math.min(1, items.length / 6)) * 100) / 100;
  }

  const importEsperat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
  const toleranciaImport = toleranciaDimport(importEsperat);
  const ultimaData = dates[dates.length - 1] as string;
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

    // Si el comerç es declarat, la cadencia la mana la persona: el detector
    // nomes refresca import, dates i aparicions.
    await db
      .update(recurringSeries)
      .set({
        ...(declarat
          ? {
              cadence: declarat.cadence,
              intervalDays: CADENCE_DAYS[declarat.cadence],
              confidence: 1,
            }
          : {
              cadence: cadencia,
              intervalDays: intervalArrodonit,
              confidence: confianca,
            }),
        occurrencesCount: items.length,
        lastSeenDate: ultimaData,
        nextExpectedDate: addDays(
          ultimaData,
          declarat ? CADENCE_DAYS[declarat.cadence] : intervalArrodonit,
        ),
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
 * Marca o desmarca un comerç com a recurrent i sincronitza la serie.
 *
 * Quan es marca, cal almenys un moviment no exclòs (i no un traspàs) per
 * poder-ne treure l'import i la data. La serie queda a la previsio i el
 * detector ja no la pot acabar.
 */
export async function declaraComercRecurrent(
  merchantId: number,
  ledgerId: number,
  opcions: { recurrent: boolean; cadence: Cadence | null },
): Promise<{ isSubscription: boolean }> {
  const [comerc] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!comerc) throw new NotFoundError("Aquest comerç no existeix");

  if (!opcions.recurrent) {
    await db
      .update(merchants)
      .set({ isRecurrent: false, recurrentCadence: null })
      .where(eq(merchants.id, merchantId));

    await db
      .update(recurringSeries)
      .set({ status: "ended", includeInForecast: false })
      .where(
        and(
          eq(recurringSeries.ledgerId, ledgerId),
          eq(recurringSeries.merchantId, merchantId),
          eq(recurringSeries.status, "active"),
        ),
      );

    return { isSubscription: false };
  }

  const cadence = opcions.cadence ?? "monthly";
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
    .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.merchantId, merchantId),
        gte(transactions.bookingDate, des),
        eq(transactions.status, "booked"),
        isNull(transactions.transferGroupId),
        eq(transactions.isExcluded, false),
      ),
    )
    .orderBy(asc(transactions.bookingDate));

  if (moviments.length === 0) {
    throw new AppError(
      "Aquest comerç encara no te moviments per projectar; importa'n algun abans de marcar-lo com a recurrent",
      422,
    );
  }

  // Una sola serie: el sentit (entrada o sortida) amb mes aparicions.
  let entrades = 0;
  let sortides = 0;
  for (const m of moviments) {
    if (money(m.amount).isPositive()) entrades += 1;
    else sortides += 1;
  }
  const sentit: "in" | "out" = entrades >= sortides ? "in" : "out";
  const items = moviments.filter((m) =>
    sentit === "in" ? money(m.amount).isPositive() : money(m.amount).isNegative(),
  );

  if (items.length === 0) {
    throw new AppError(
      "Aquest comerç encara no te moviments per projectar; importa'n algun abans de marcar-lo com a recurrent",
      422,
    );
  }

  const clau = signatura(items[0] as MovimentSerie);
  if (clau === null) {
    throw new AppError("No s'ha pogut identificar la serie d'aquest comerç", 422);
  }

  await db
    .update(merchants)
    .set({ isRecurrent: true, recurrentCadence: cadence })
    .where(eq(merchants.id, merchantId));

  const dates = items.map((i) => i.bookingDate);
  const importEsperat = medianaImports(items.map((i) => i.amount)).toDecimalPlaces(2);
  const toleranciaImport = toleranciaDimport(importEsperat);
  const intervalDies = CADENCE_DAYS[cadence];
  const ultimaData = dates[dates.length - 1] as string;
  const ultim = items[items.length - 1] as MovimentSerie;
  const isSubscription = cadence === "monthly" && money(ultim.amount).isNegative();

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
        merchantId,
        categoryId: ultim.categoryId,
        cadence,
        expectedAmount: toMoneyString(importEsperat),
        amountTolerance: toMoneyString(toleranciaImport),
        intervalDays: intervalDies,
        confidence: 1,
        occurrencesCount: items.length,
        firstSeenDate: dates[0] as string,
        lastSeenDate: ultimaData,
        nextExpectedDate: addDays(ultimaData, intervalDies),
        isSubscription,
        status: "active",
        includeInForecast: true,
      })
      .returning({ id: recurringSeries.id });
    if (!creada) throw new AppError("No s'ha pogut crear la serie recurrent", 500);
    serieId = creada.id;
  } else {
    serieId = existent.id;
    await db
      .update(recurringSeries)
      .set({
        label: etiquetaSerie(ultim),
        merchantId,
        categoryId: ultim.categoryId ?? existent.categoryId,
        cadence,
        expectedAmount: toMoneyString(importEsperat),
        amountTolerance: toMoneyString(toleranciaImport),
        intervalDays: intervalDies,
        confidence: 1,
        occurrencesCount: items.length,
        firstSeenDate: dates[0] as string,
        lastSeenDate: ultimaData,
        nextExpectedDate: addDays(ultimaData, intervalDies),
        isSubscription,
        status: "active",
        includeInForecast: true,
      })
      .where(eq(recurringSeries.id, serieId));
  }

  await enllacaAparicions(serieId, items);
  return { isSubscription };
}

/**
 * Avisa dels rebuts que no han arribat quan tocava.
 *
 * Passat mes d'un periode sencer sense saber-ne res, la serie es dona per
 * acabada en lloc d'anar avisant per sempre. Les series d'un comerç marcat
 * com a recurrent **no** s'acaben: la persona les ha volgut a la previsio.
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

  const merchantIds = [
    ...new Set(series.map((s) => s.merchantId).filter((id): id is number => id !== null)),
  ];
  const declarats = new Set<number>();
  if (merchantIds.length > 0) {
    const files = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(inArray(merchants.id, merchantIds), eq(merchants.isRecurrent, true)));
    for (const f of files) declarats.add(f.id);
  }

  for (const serie of series) {
    const prevista = serie.nextExpectedDate;
    if (prevista === null) continue;

    const diesDeRetard = daysBetween(prevista, avui);
    if (diesDeRetard < MISSING_GRACE_DAYS) continue;

    if (diesDeRetard > serie.intervalDays + MISSING_GRACE_DAYS) {
      // Un comerç declarat es queda actiu encara que el rebut no arribi.
      if (serie.merchantId !== null && declarats.has(serie.merchantId)) continue;

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
