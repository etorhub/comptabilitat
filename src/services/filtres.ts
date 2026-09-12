/**
 * What counts as a real transaction.
 *
 * A transaction only adds to the reports, the forecast and the recurring
 * detection if it meets **all** of these conditions:
 *
 *   - it belongs to the workspace being looked at;
 *   - it is booked (`booked`), not pending;
 *   - it is not part of a transfer between the owner's own accounts, which
 *     only moves the money around;
 *   - and nobody has excluded it by hand.
 *
 * **This lives in a single place on purpose.** There were five copies written
 * by hand and they did not all say the same: the transfers one forgot
 * `is_excluded`, and that is why an excluded transaction could enter a pair
 * and take the other leg out of the reports without anyone asking. If one day
 * what counts has to change, it changes here.
 */

import { and, eq, gte, inArray, isNull, lt, lte, type SQL } from "drizzle-orm";

import { transactions } from "../db/schema/index.ts";

export interface FilterOptions {
  /** One workspace or several. */
  workspaces: number | number[];
  /** From this date, inclusive. */
  des?: string | null;
  /** Up to this date, inclusive. */
  fins?: string | null;
  /** Only the ones that take money out. */
  onlyExpenses?: boolean;
}

export function countableTransactions(options: FilterOptions): SQL | undefined {
  const workspaces = Array.isArray(options.workspaces)
    ? options.workspaces
    : [options.workspaces];

  const parts: (SQL | undefined)[] = [
    inArray(transactions.ledgerId, workspaces),
    eq(transactions.status, "booked"),
    isNull(transactions.transferGroupId),
    eq(transactions.isExcluded, false),
  ];

  if (options.des != null) parts.push(gte(transactions.bookingDate, options.des));
  if (options.fins != null) parts.push(lte(transactions.bookingDate, options.fins));
  if (options.onlyExpenses === true) parts.push(lt(transactions.amount, "0"));

  return and(...parts);
}
