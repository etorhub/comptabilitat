/**
 * Which calendar date a transaction counts on for income and expense reports.
 *
 * The bank's `booking_date` stays untouched (sync, balances, dedup). This
 * module only decides the date used when asking "which month does it belong
 * to in the books?".
 *
 * Rule for salary (`SLUG_SALARY`): a booking on day 28–31 of the month counts
 * on the first day of the next month — pay that lands at the end of January
 * is February's pay. Anything else keeps the booking date.
 *
 * A person can override the date; while `reporting_date_manual` is set, this
 * module does not rewrite it.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { categories, transactions } from "../db/schema/index.ts";
import { addMonths } from "../lib/time.ts";
import { SLUG_SALARY } from "./slugs.ts";

/** From this day of the month onward, salary counts in the next month. */
export const SALARY_SHIFT_FROM_DAY = 28;

/**
 * SQL expression: the date reports filter and group by.
 * `coalesce(reporting_date, booking_date)`.
 */
export const effectiveReportingDate = sql<string>`coalesce(${transactions.reportingDate}, ${transactions.bookingDate})`;

/**
 * The reporting date the late-salary rule would pick, or `null` when it is
 * the same as the booking date (no shift).
 */
export function autoReportingDate(
  bookingDate: string,
  categorySlug: string | null | undefined,
): string | null {
  if (categorySlug !== SLUG_SALARY) return null;
  const day = Number(bookingDate.slice(8, 10));
  if (!Number.isFinite(day) || day < SALARY_SHIFT_FROM_DAY) return null;
  return `${addMonths(bookingDate.slice(0, 7), 1)}-01`;
}

/** What a row effectively counts as, for display and tests. */
export function effectiveDate(
  bookingDate: string,
  reportingDate: string | null | undefined,
): string {
  return reportingDate ?? bookingDate;
}

/**
 * Recomputes `reporting_date` from the category and booking date, unless a
 * person locked it. Safe to call after classify, categorize or a booking-date
 * refresh from the bank.
 */
export async function refreshReportingDate(
  transactionId: number,
  connection: Transactor = db,
): Promise<void> {
  const [row] = await connection
    .select({
      bookingDate: transactions.bookingDate,
      manual: transactions.reportingDateManual,
      slug: categories.slug,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!row || row.manual) return;

  await connection
    .update(transactions)
    .set({ reportingDate: autoReportingDate(row.bookingDate, row.slug) })
    .where(eq(transactions.id, transactionId));
}

/**
 * The same, for every row matching `where` that is not manually locked.
 */
export async function refreshReportingDatesWhere(
  where: SQL | undefined,
  connection: Transactor = db,
): Promise<void> {
  const rows = await connection
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      slug: categories.slug,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.reportingDateManual, false), where));

  for (const row of rows) {
    await connection
      .update(transactions)
      .set({ reportingDate: autoReportingDate(row.bookingDate, row.slug) })
      .where(eq(transactions.id, row.id));
  }
}

/**
 * A person sets the reporting date.
 *
 * `null` means “follow the rule again” (late salary may shift). Any concrete
 * date — including the booking date itself — locks it so the rule leaves it
 * alone; storing `null` with the manual flag keeps the bank date without a
 * redundant copy of the column.
 */
export async function setReportingDate(
  transactionId: number,
  bookingDate: string,
  next: string | null,
): Promise<void> {
  if (next === null) {
    await db
      .update(transactions)
      .set({ reportingDate: null, reportingDateManual: false })
      .where(eq(transactions.id, transactionId));
    await refreshReportingDate(transactionId);
    return;
  }

  await db
    .update(transactions)
    .set({
      reportingDate: next === bookingDate ? null : next,
      reportingDateManual: true,
    })
    .where(eq(transactions.id, transactionId));
}
