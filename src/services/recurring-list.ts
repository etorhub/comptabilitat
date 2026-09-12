/**
 * Query of the recurring series, for the screen.
 */

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type AmountMode,
  type Cadence,
  type SeriesStatus,
} from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { toMoneyString, type MoneyString } from "../lib/money.ts";
import { parseDescription } from "./concepte.ts";
import { monthlyCost } from "./recurring.ts";

export interface SeriesView {
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

/** A real transaction linked to a series (already masked). */
export interface OccurrenceView {
  transactionId: number;
  bookingDate: string;
  description: string;
  amount: MoneyString;
}

function toView(
  series: typeof recurringSeries.$inferSelect,
  categoryName: string | null,
): SeriesView {
  return {
    id: series.id,
    label: series.label,
    categoryId: series.categoryId,
    categoryName,
    cadence: series.cadence,
    expectedAmount: series.expectedAmount,
    amountTolerance: series.amountTolerance,
    amountMode: series.amountMode,
    intervalDays: series.intervalDays,
    monthlyCost: toMoneyString(monthlyCost(series.expectedAmount, series.intervalDays)),
    confidence: series.confidence,
    occurrencesCount: series.occurrencesCount,
    firstSeenDate: series.firstSeenDate,
    lastSeenDate: series.lastSeenDate,
    nextExpectedDate: series.nextExpectedDate,
    status: series.status,
    includeInForecast: series.includeInForecast,
  };
}

export async function listSeries(
  ledgerId: number,
  options: { statuses?: SeriesStatus[]; inclouAcabades?: boolean } = {},
): Promise<SeriesView[]> {
  const parts = [eq(recurringSeries.ledgerId, ledgerId)];
  if (options.statuses && options.statuses.length > 0) {
    parts.push(inArray(recurringSeries.status, options.statuses));
  } else if (!options.inclouAcabades) {
    parts.push(ne(recurringSeries.status, "ended"));
    parts.push(ne(recurringSeries.status, "dismissed"));
  }

  const rows = await db
    .select({
      series: recurringSeries,
      categoryName: categories.name,
    })
    .from(recurringSeries)
    .innerJoin(categories, eq(categories.id, recurringSeries.categoryId))
    .where(and(...parts))
    .orderBy(asc(recurringSeries.nextExpectedDate), asc(recurringSeries.label));

  return rows.map(({ series, categoryName }) => toView(series, categoryName));
}

export async function seriesInWorkspace(id: number, ledgerId: number) {
  const [series] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.id, id), eq(recurringSeries.ledgerId, ledgerId)))
    .limit(1);
  if (!series) throw new NotFoundError("Aquesta serie no existeix");
  return series;
}

export async function seriesView(id: number, ledgerId: number): Promise<SeriesView> {
  const [row] = await db
    .select({
      series: recurringSeries,
      categoryName: categories.name,
    })
    .from(recurringSeries)
    .innerJoin(categories, eq(categories.id, recurringSeries.categoryId))
    .where(and(eq(recurringSeries.id, id), eq(recurringSeries.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquesta serie no existeix");
  return toView(row.series, row.categoryName);
}

/**
 * The bank transactions linked to the series. It checks the workspace and
 * applies the concept masking (the alias if there is one).
 */
export async function seriesOccurrences(
  seriesId: number,
  ledgerId: number,
): Promise<OccurrenceView[]> {
  await seriesInWorkspace(seriesId, ledgerId);

  const rows = await db
    .select({
      transactionId: transactions.id,
      bookingDate: transactions.bookingDate,
      description: transactions.description,
      displayDescription: transactions.displayDescription,
      amount: transactions.amount,
    })
    .from(recurringOccurrences)
    .innerJoin(transactions, eq(transactions.id, recurringOccurrences.transactionId))
    .where(
      and(eq(recurringOccurrences.seriesId, seriesId), eq(transactions.ledgerId, ledgerId)),
    )
    .orderBy(desc(transactions.bookingDate), desc(transactions.id));

  return rows.map((f) => {
    const masked = f.displayDescription !== null && f.displayDescription !== "";
    return {
      transactionId: f.transactionId,
      bookingDate: f.bookingDate,
      description: masked
        ? (f.displayDescription ?? "")
        : parseDescription(f.description).title,
      amount: f.amount,
    };
  });
}
