/**
 * Assigning a category to a workspace's transactions.
 *
 * The resolution order is always the same, from the cheapest and most
 * explicit to the most expensive:
 *
 *   1. **a person's decision, which is never touched**;
 *   2. the workspace's merchant memory;
 *   3. whatever is left, pending review.
 *
 * Everything happens inside a single workspace: nothing decided here affects
 * the others. A translation of `backend/app/services/classification.py`
 * (without the rules step, which was dropped from the product).
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import {
  categories,
  merchants,
  transactions,
  type CategorySource,
} from "../db/schema/index.ts";
import { SLUG_INTERNAL_TRANSFER, SLUG_UNCATEGORIZED } from "./slugs.ts";

export interface ClassificationStats {
  byMerchant: number;
  pending: number;
}

export function summaryStats(s: ClassificationStats): string {
  return `${s.byMerchant} per comerç, ${s.pending} pendents de revisar`;
}

/** The transaction as the classification needs it. */
interface ClassifiableTransaction {
  id: number;
  ledgerId: number | null;
  merchantId: number | null;
  categorySource: CategorySource;
}

/**
 * Classifies a transaction. **It never touches what a person decided.**
 *
 * Returns where the category came from. It writes straight to the database,
 * so it can be called inside a transaction.
 */
export async function classifyTransaction(
  transaction: ClassifiableTransaction,
  connection: Transactor = db,
): Promise<CategorySource> {
  if (transaction.categorySource === "user") return "user";

  // An account with no workspace assigned yet has no categories.
  if (transaction.ledgerId === null) return "none";

  if (transaction.merchantId !== null) {
    const [merchant] = await connection
      .select()
      .from(merchants)
      .where(eq(merchants.id, transaction.merchantId))
      .limit(1);

    if (merchant && merchant.defaultCategoryId !== null) {
      await connection
        .update(transactions)
        .set({
          categoryId: merchant.defaultCategoryId,
          categorySource: "merchant",
          // If a person confirmed the merchant, we trust it completely; if
          // not, it is a guess and somebody has to look at it.
          categoryConfidence: merchant.isConfirmed ? 1 : 0.8,
          needsReview: !merchant.isConfirmed,
        })
        .where(eq(transactions.id, transaction.id));
      return "merchant";
    }
  }

  await connection
    .update(transactions)
    .set({ categorySource: "none", needsReview: true })
    .where(eq(transactions.id, transaction.id));
  return "none";
}

/** The fields the classification needs from a transaction. */
const FIELDS_CLASSIFICATION = {
  id: transactions.id,
  ledgerId: transactions.ledgerId,
  merchantId: transactions.merchantId,
  categorySource: transactions.categorySource,
} as const;

/**
 * Classifies a workspace's transactions that still have no category.
 *
 * It only looks at those coming from `none` or `merchant`: the ones a person
 * set are not touched.
 */
export async function classifyPending(
  ledgerId: number,
  limit?: number,
): Promise<ClassificationStats> {
  const stats: ClassificationStats = {
    byMerchant: 0,
    pending: 0,
  };

  const query = db
    .select(FIELDS_CLASSIFICATION)
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        inArray(transactions.categorySource, ["none", "merchant"]),
        or(isNull(transactions.categoryId), eq(transactions.needsReview, true)),
      ),
    )
    .orderBy(desc(transactions.bookingDate));

  const candidats = limit ? await query.limit(limit) : await query;

  for (const transaction of candidats) {
    const origin = await classifyTransaction(transaction);
    if (origin === "merchant") stats.byMerchant += 1;
    else stats.pending += 1;
  }

  return stats;
}

/** A category of the workspace by its stable slug. */
export async function categoryBySlug(
  ledgerId: number,
  slug: string,
  connection: Transactor = db,
) {
  const [category] = await connection
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  return category ?? null;
}

export async function uncategorizedCategory(ledgerId: number, connection: Transactor = db) {
  return categoryBySlug(ledgerId, SLUG_UNCATEGORIZED, connection);
}

/**
 * The category of the internal transfers. If somebody changed its type, it is
 * no use: better to pair nothing than to pair it wrong.
 */
export async function transferCategory(ledgerId: number, connection: Transactor = db) {
  const category = await categoryBySlug(ledgerId, SLUG_INTERNAL_TRANSFER, connection);
  if (category !== null && category.kind !== "transfer") return null;
  return category;
}
