/**
 * Consulta de les series recurrents, per a la pantalla.
 */

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { categories, recurringSeries, type Cadence, type SeriesStatus } from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { costMensual } from "./recurring.ts";

export interface SerieVista {
  id: number;
  label: string;
  categoryId: number | null;
  categoryName: string | null;
  cadence: Cadence;
  expectedAmount: MoneyString;
  amountTolerance: MoneyString;
  intervalDays: number;
  /** L'import repartit per mes, per poder-les comparar entre elles. */
  monthlyCost: MoneyString;
  confidence: number;
  occurrencesCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  nextExpectedDate: string | null;
  isSubscription: boolean;
  status: SeriesStatus;
  includeInForecast: boolean;
}

export async function llistaSeries(
  ledgerId: number,
  nomesSubscripcions: boolean,
  incloAcabades: boolean,
): Promise<SerieVista[]> {
  const parts = [eq(recurringSeries.ledgerId, ledgerId)];
  if (nomesSubscripcions) parts.push(eq(recurringSeries.isSubscription, true));
  if (!incloAcabades) parts.push(ne(recurringSeries.status, "ended"));

  const files = await db
    .select({ serie: recurringSeries, categoryName: categories.name })
    .from(recurringSeries)
    .leftJoin(categories, eq(categories.id, recurringSeries.categoryId))
    .where(and(...parts))
    .orderBy(asc(recurringSeries.nextExpectedDate), asc(recurringSeries.label));

  return files.map(({ serie, categoryName }) => ({
    id: serie.id,
    label: serie.label,
    categoryId: serie.categoryId,
    categoryName,
    cadence: serie.cadence,
    expectedAmount: serie.expectedAmount,
    amountTolerance: serie.amountTolerance,
    intervalDays: serie.intervalDays,
    monthlyCost: toMoneyString(costMensual(serie.expectedAmount, serie.intervalDays)),
    confidence: serie.confidence,
    occurrencesCount: serie.occurrencesCount,
    firstSeenDate: serie.firstSeenDate,
    lastSeenDate: serie.lastSeenDate,
    nextExpectedDate: serie.nextExpectedDate,
    isSubscription: serie.isSubscription,
    status: serie.status,
    includeInForecast: serie.includeInForecast,
  }));
}

export async function serieDeLespai(id: number, ledgerId: number) {
  const [serie] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.id, id), eq(recurringSeries.ledgerId, ledgerId)))
    .limit(1);
  if (!serie) throw new NotFoundError("Aquesta serie no existeix");
  return serie;
}

export async function vistaSerie(id: number, ledgerId: number): Promise<SerieVista> {
  const totes = await llistaSeries(ledgerId, false, true);
  const trobada = totes.find((s) => s.id === id);
  if (!trobada) throw new NotFoundError("Aquesta serie no existeix");
  return trobada;
}

export interface ResumSubscripcions {
  mensual: MoneyString;
  anual: MoneyString;
}

/**
 * Quant costen les subscripcions.
 *
 * Nomes conta les series actives que treuen diners: una subscripcio que ja
 * s'ha donat de baixa no compta, i un ingres recurrent tampoc.
 */
export async function resumSubscripcions(ledgerId: number): Promise<ResumSubscripcions> {
  const series = await db
    .select({
      expectedAmount: recurringSeries.expectedAmount,
      intervalDays: recurringSeries.intervalDays,
    })
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        eq(recurringSeries.isSubscription, true),
      ),
    );

  let mensual = new Decimal(0);
  for (const serie of series) {
    const cost = costMensual(serie.expectedAmount, serie.intervalDays);
    if (cost.isNegative()) mensual = mensual.plus(cost.abs());
  }

  return {
    mensual: toMoneyString(mensual),
    anual: toMoneyString(mensual.times(12)),
  };
}

export { money };
