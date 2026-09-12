/**
 * Pairing of transfers between the owner's own accounts.
 *
 * Moving money between two accounts **of the same workspace** is neither
 * income nor expense: it only changes place. When an equal debit and credit
 * are paired, they stay out of the reports.
 *
 * What arrives **from another workspace**, on the other hand, does count: to
 * whoever looks at Calella, money coming in is a real credit, and where it
 * comes from is not their business. That is why all of this happens inside a
 * single workspace.
 *
 */

import { asc, eq } from "drizzle-orm";

import { countableTransactions } from "./filters.ts";
import { db } from "../db/client.ts";
import { transactions } from "../db/schema/index.ts";
import { money } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { transferCategory } from "./classification.ts";

/** Margin in days between the debit of one account and the credit of the other. */
const MATCH_WINDOW_DAYS = 3;

interface Candidate {
  id: number;
  accountId: number;
  bookingDate: string;
  amount: string;
  categorySource: string;
}

/** Pairs equivalent debits and credits between accounts of the same workspace. */
export async function detectTransfers(ledgerId: number, lookbackDays = 120): Promise<number> {
  const des = addDays(todayLocal(), -lookbackDays);

  const candidates = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      bookingDate: transactions.bookingDate,
      amount: transactions.amount,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    // The same filter the reports use. The `is_excluded` here is not a detail:
    // pairing an excluded transaction would write the group **on the other
    // leg** and take it out of the reports without anyone asking.
    .where(countableTransactions({ workspaces: ledgerId, des }))
    .orderBy(asc(transactions.bookingDate), asc(transactions.id));

  const debits = candidates.filter((c) => money(c.amount).isNegative());
  const entries = candidates.filter((c) => money(c.amount).isPositive());
  if (debits.length === 0 || entries.length === 0) return 0;

  const category = await transferCategory(ledgerId);
  const spent = new Set<number>();
  let pairs = 0;

  for (const output of debits) {
    if (spent.has(output.id)) continue;

    const counterparty = findCounterparty(output, entries, spent);
    if (counterparty === null) continue;

    const group = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    // **Both legs, or neither.** If only one is labelled, the reports leave
    // the debit out and go on counting the credit: the month comes out wrong
    // by the whole amount and looks right. And it no longer repairs itself,
    // because the orphan leg has a `transfer_group_id` and this query only
    // looks at those with an empty one.
    await db.transaction(async (tx) => {
      for (const item of [output, counterparty]) {
        // Typed with the table: that way a mistake in a field name does not
        // compile, instead of being written silently.
        const changes: Partial<typeof transactions.$inferInsert> = { transferGroupId: group };

        // Nobody picks the category of a transfer every time, but if a person
        // has set one, it is respected.
        if (category !== null && item.categorySource !== "user") {
          changes.categoryId = category.id;
          changes.categorySource = "rule";
          changes.categoryConfidence = 1;
          changes.needsReview = false;
        }

        await tx.update(transactions).set(changes).where(eq(transactions.id, item.id));
      }
    });

    spent.add(output.id);
    spent.add(counterparty.id);
    pairs += 1;
  }

  if (pairs > 0) {
    console.info(`[traspassos] ${pairs} aparellats dins de l'espai ${ledgerId}`);
  }
  return pairs;
}

/**
 * The credit leg that pairs with a given debit leg.
 *
 * It has to be on a **different account**, for the same amount with the sign
 * flipped, and inside the window; if there is more than one, the closest in
 * time wins.
 */
function findCounterparty(
  debit: Candidate,
  credits: Candidate[],
  used: Set<number>,
): Candidate | null {
  const target = money(debit.amount).negated();
  let best: Candidate | null = null;
  let bestDistance = MATCH_WINDOW_DAYS + 1;

  for (const credit of credits) {
    if (used.has(credit.id) || credit.id === debit.id) continue;
    // Within the same account it is not a transfer.
    if (credit.accountId === debit.accountId) continue;
    if (!money(credit.amount).equals(target)) continue;

    const distance = Math.abs(daysBetween(debit.bookingDate, credit.bookingDate));
    if (distance > MATCH_WINDOW_DAYS) continue;

    if (distance < bestDistance) {
      best = credit;
      bestDistance = distance;
    }
  }

  return best;
}
