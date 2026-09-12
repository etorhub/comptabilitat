/**
 * Setting a transaction's category because a person said so.
 *
 * It is the decision that **nothing else touches**: no rule, no merchant
 * memory and no local model will change it again. That is all
 * `category_source = "user"` means, and that is why the four fields that say
 * it go together in one place: they were written by hand four times inside
 * the same route file, and changing the policy meant finding them all.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { llmSuggestions, merchants, transactions } from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { rememberMerchantChoice } from "./merchants.ts";

/** What «a person decided it» means. */
export const HUMAN_DECISION = {
  categorySource: "user",
  categoryConfidence: 1,
  needsReview: false,
} as const;

export interface CategorizeOptions {
  /** Remember it for every transaction of this merchant in this workspace. */
  rememberMerchant?: boolean;
}

export interface CategorizeResult {
  /** How many transactions of the same merchant inherited the decision. */
  recordats: number;
}

/**
 * Sets the category on a transaction, with whatever follows from it.
 *
 * Everything goes inside a transaction: if the merchant memory is written and
 * transaction is not —or the other way round— the workspace says two different things.
 */
export async function categorizeTransaction(
  transactionId: number,
  row: { merchantId: number | null },
  categoryId: number | null,
  options: CategorizeOptions = {},
): Promise<CategorizeResult> {
  return db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId, ...HUMAN_DECISION })
      .where(eq(transactions.id, transactionId));

    let recordats = 0;
    if (options.rememberMerchant === true && row.merchantId !== null) {
      recordats = await rememberMerchantFromRow(tx, row.merchantId, categoryId);
    }

    return { recordats };
  });
}

/**
 * The same, for several transactions at once.
 *
 * **All or nothing**: if any id is not from the workspace, none is applied.
 * A half-done request would leave whoever made it not knowing what changed.
 */
export async function categorizeBulk(
  movimentIds: number[],
  ledgerId: number,
  categoryId: number | null,
  options: { rememberMerchant?: boolean } = {},
): Promise<{ aplicats: number }> {
  const demanats = [...new Set(movimentIds)];

  return db.transaction(async (tx) => {
    const meus = await tx
      .select({ id: transactions.id, merchantId: transactions.merchantId })
      .from(transactions)
      .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, demanats)));

    if (meus.length !== demanats.length) {
      throw new NotFoundError("No s'ha trobat");
    }

    await tx
      .update(transactions)
      .set({ categoryId, ...HUMAN_DECISION })
      .where(
        inArray(
          transactions.id,
          meus.map((m) => m.id),
        ),
      );

    if (options.rememberMerchant === true) {
      const merchantIds = [
        ...new Set(meus.map((m) => m.merchantId).filter((x): x is number => x !== null)),
      ];
      for (const merchantId of merchantIds) {
        await rememberMerchantFromRow(tx, merchantId, categoryId);
      }
    }

    return { aplicats: meus.length };
  });
}

/**
 * Confirming a transaction from the review tray.
 *
 * It is the same as changing its category, and on top of that it **closes the
 * model's proposal** saying whether it got it right: the only way to know if it is worth it.
 */
export async function confirmFromReview(
  transactionId: number,
  row: { merchantId: number | null },
  categoryId: number,
  options: CategorizeOptions = {},
): Promise<CategorizeResult> {
  const result = await categorizeTransaction(transactionId, row, categoryId, options);
  await closeModelProposal(row.merchantId, categoryId);
  return result;
}

/** Says whether the model's proposal for this merchant was good. */
async function closeModelProposal(
  merchantId: number | null,
  categoryId: number,
): Promise<void> {
  if (merchantId === null) return;

  const [proposal] = await db
    .select()
    .from(llmSuggestions)
    .where(and(eq(llmSuggestions.merchantId, merchantId), isNull(llmSuggestions.accepted)))
    .limit(1);
  if (!proposal) return;

  await db
    .update(llmSuggestions)
    .set({
      accepted: proposal.suggestedCategoryId === categoryId,
      reviewedAt: new Date(),
    })
    .where(eq(llmSuggestions.id, proposal.id));
}

async function rememberMerchantFromRow(
  tx: Transactor,
  merchantId: number,
  categoryId: number | null,
): Promise<number> {
  const [merchant] = await tx
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!merchant) return 0;
  return rememberMerchantChoice(merchant, categoryId, true, tx);
}
