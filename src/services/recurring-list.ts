/**
 * Consulta de les series recurrents, per a la pantalla.
 */

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  recurringSeries,
  type AmountMode,
  type Cadence,
  type SeriesStatus,
} from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { toMoneyString, type MoneyString } from "../lib/money.ts";
import { costMensual } from "./recurring.ts";

export interface SerieVista {
  id: number;
  label: string;
  categoryId: number;
  categoryName: string | null;
  cadence: Cadence;
  expectedAmount: MoneyString;
  amountTolerance: MoneyString;
  amountMode: AmountMode;
  intervalDays: number;
  monthlyCost: MoneyString;
  confidence: number;
  occurrencesCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  nextExpectedDate: string | null;
  status: SeriesStatus;
  includeInForecast: boolean;
}

function aVista(
  serie: typeof recurringSeries.$inferSelect,
  categoryName: string | null,
): SerieVista {
  return {
    id: serie.id,
    label: serie.label,
    categoryId: serie.categoryId,
    categoryName,
    cadence: serie.cadence,
    expectedAmount: serie.expectedAmount,
    amountTolerance: serie.amountTolerance,
    amountMode: serie.amountMode,
    intervalDays: serie.intervalDays,
    monthlyCost: toMoneyString(costMensual(serie.expectedAmount, serie.intervalDays)),
    confidence: serie.confidence,
    occurrencesCount: serie.occurrencesCount,
    firstSeenDate: serie.firstSeenDate,
    lastSeenDate: serie.lastSeenDate,
    nextExpectedDate: serie.nextExpectedDate,
    status: serie.status,
    includeInForecast: serie.includeInForecast,
  };
}

export async function llistaSeries(
  ledgerId: number,
  opcions: { estats?: SeriesStatus[]; inclouAcabades?: boolean } = {},
): Promise<SerieVista[]> {
  const parts = [eq(recurringSeries.ledgerId, ledgerId)];
  if (opcions.estats && opcions.estats.length > 0) {
    parts.push(inArray(recurringSeries.status, opcions.estats));
  } else if (!opcions.inclouAcabades) {
    parts.push(ne(recurringSeries.status, "ended"));
    parts.push(ne(recurringSeries.status, "dismissed"));
  }

  const files = await db
    .select({
      serie: recurringSeries,
      categoryName: categories.name,
    })
    .from(recurringSeries)
    .innerJoin(categories, eq(categories.id, recurringSeries.categoryId))
    .where(and(...parts))
    .orderBy(asc(recurringSeries.nextExpectedDate), asc(recurringSeries.label));

  return files.map(({ serie, categoryName }) => aVista(serie, categoryName));
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
  const [fila] = await db
    .select({
      serie: recurringSeries,
      categoryName: categories.name,
    })
    .from(recurringSeries)
    .innerJoin(categories, eq(categories.id, recurringSeries.categoryId))
    .where(and(eq(recurringSeries.id, id), eq(recurringSeries.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquesta serie no existeix");
  return aVista(fila.serie, fila.categoryName);
}
