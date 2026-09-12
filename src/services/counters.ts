/**
 * The sidebar counters.
 *
 * They live in a service of their own because they are **out-of-band
 * targets**: whoever changes them has to redraw them, and whoever changes
 * them is not always the same resource that shows them. Categorizing a
 * transaction moves the «to review» one; dismissing an alert moves the alerts one.
 *
 * This replaces the previous application's `invalidaEspai()`, which after any
 * mutation asked again for the list, the dashboard and both counters. Now it
 * says exactly what changes.
 */

import { and, count, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { alerts, transactions } from "../db/schema/index.ts";

/** Transactions waiting for somebody to confirm their category. */
export async function countToReview(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.needsReview, true)));
  return row?.n ?? 0;
}

/** Alerts nobody has looked at yet. */
export async function countNewAlerts(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), eq(alerts.status, "new")));
  return row?.n ?? 0;
}

export interface Counters {
  perRevisar: number;
  newAlerts: number;
}

/** Both at once, for drawing a whole page. */
export async function counters(ledgerId: number): Promise<Counters> {
  const [perRevisar, newAlerts] = await Promise.all([
    countToReview(ledgerId),
    countNewAlerts(ledgerId),
  ]);
  return { perRevisar, newAlerts };
}
