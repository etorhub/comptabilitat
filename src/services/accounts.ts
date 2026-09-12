/**
 * Life cycle of a bank account inside the workspaces.
 *
 * The only thing here is moving an account between workspaces, and it is
 * delicate enough to have its own module: it touches the account's whole
 * history and used to live inside a ninety-line route handler.
 */

import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, categories, ledgers, transactions } from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { classifyPending } from "./classification.ts";
import { getOrCreateMerchant } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";

export interface TransactionSummary {
  /** Transactions that changed workspace. */
  moguts: number;
  /** Of those, the ones whose person-chosen category could be kept. */
  conservades: number;
  /** Transfers of the old workspace that had to be undone. */
  undoneTransfers: number;
}

/**
 * Moves an account —and all its history— to another workspace.
 *
 * **This is not an operation to do often.** Categories, merchants and rules
 * belong to each workspace, so the old workspace's ids mean nothing in the
 * new one and the classification has to be redone.
 *
 * What **is** kept is what a person decided. Every workspace is seeded with
 * the same category plan, so the *slug* («alimentacio-supermercat») does mean
 * the same on both sides: transactions with `category_source = "user"` are
 * re-linked by slug in the new workspace. Those that do not fit —a category
 * that only existed in the old workspace— go to the review tray, like the
 * rest.
 *
 * The structural part goes inside a transaction. The final reclassification
 * does not: it is idempotent and can be run again, and if it fails the worst
 * that happens is that a few transactions stay pending review, which is the
 */
export async function moveAccountToWorkspace(
  accountId: number,
  newWorkspace: number | null,
): Promise<TransactionSummary> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new NotFoundError("Aquest compte no existeix");

  if (newWorkspace !== null) {
    const [workspace] = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(eq(ledgers.id, newWorkspace))
      .limit(1);
    if (!workspace) throw new NotFoundError("Aquest espai no existeix");
  }

  if (newWorkspace === account.ledgerId) {
    return { moguts: 0, conservades: 0, undoneTransfers: 0 };
  }

  const summary = await db.transaction(async (tx) => {
    // --- What has to be remembered before deleting it ---

    // A person's decisions, noted by slug, which is what means the same in
    // every workspace.
    const decisions = await tx
      .select({ transactionId: transactions.id, slug: categories.slug })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(eq(transactions.accountId, accountId), eq(transactions.categorySource, "user")),
      );

    // The transfers where this account was one of the two legs. The other one
    // stays in the old workspace, and if we do not remove its group it is left
    // pointing at a pairing that no longer exists: out of the reports forever,
    // with nothing to pair up with again.
    const groups = (
      await tx
        .selectDistinct({ group: transactions.transferGroupId })
        .from(transactions)
        .where(
          and(eq(transactions.accountId, accountId), isNotNull(transactions.transferGroupId)),
        )
    )
      .map((f) => f.group)
      .filter((g): g is string => g !== null);

    let undoneTransfers = 0;
    if (groups.length > 0) {
      const orfes = await tx
        .update(transactions)
        .set({ transferGroupId: null })
        .where(
          and(
            inArray(transactions.transferGroupId, groups),
            ne(transactions.accountId, accountId),
          ),
        )
        .returning({ id: transactions.id });
      undoneTransfers = orfes.length;
    }

    // --- The move ---

    await tx.update(accounts).set({ ledgerId: newWorkspace }).where(eq(accounts.id, accountId));

    const moguts = await tx
      .update(transactions)
      .set({
        ledgerId: newWorkspace,
        merchantId: null,
        categoryId: null,
        categorySource: "none",
        categoryConfidence: null,
        appliedRuleId: null,
        transferGroupId: null,
        needsReview: true,
      })
      .where(eq(transactions.accountId, accountId))
      .returning({ id: transactions.id });

    let conservades = 0;
    if (newWorkspace !== null) {
      // --- What is recovered ---
      conservades = await returnsLesDecisions(tx, newWorkspace, decisions);
      await redoCounterparties(tx, accountId, newWorkspace);
    }

    // The merchants of **both** workspaces are left out of true: those of the
    // new one because `getOrCreateMerchant` raises the counter one by one and
    // here it has been called once per group, and those of the old one because
    // they count transactions that are no longer there.
    await boxTheCounters(tx, [account.ledgerId, newWorkspace]);

    return { moguts: moguts.length, conservades, undoneTransfers };
  });

  // Outside the transaction on purpose: `classifyPending` opens its own
  // queries and would see nothing of what has not been committed yet.
  if (newWorkspace !== null) await classifyPending(newWorkspace);

  return summary;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Puts back the categories a person had chosen, linking them by slug in the
 * new workspace. Returns how many could be recovered.
 */
async function returnsLesDecisions(
  tx: Tx,
  newWorkspace: number,
  decisions: { transactionId: number; slug: string }[],
): Promise<number> {
  if (decisions.length === 0) return 0;

  const slugs = [...new Set(decisions.map((d) => d.slug))];
  const destins = await tx
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(and(eq(categories.ledgerId, newWorkspace), inArray(categories.slug, slugs)));

  const perSlug = new Map(destins.map((c) => [c.slug, c.id]));

  // One `update` per destination category, not per transaction.
  const byCategory = new Map<number, number[]>();
  for (const decision of decisions) {
    const categoryId = perSlug.get(decision.slug);
    if (categoryId === undefined) continue;
    byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), decision.transactionId]);
  }

  let conservades = 0;
  for (const [categoryId, ids] of byCategory) {
    await tx
      .update(transactions)
      .set({
        categoryId: categoryId,
        categorySource: "user",
        categoryConfidence: 1,
        needsReview: false,
      })
      .where(inArray(transactions.id, ids));
    conservades += ids.length;
  }

  return conservades;
}

/**
 * Recreates the merchants inside the new workspace and links the transactions to them.
 *
 * It goes by group and not by transaction: an account with three thousand
 * entries usually has a few dozen counterparties, and the difference is thousands of queries.
 */
async function redoCounterparties(
  tx: Tx,
  accountId: number,
  newWorkspace: number,
): Promise<void> {
  const seus = await tx
    .select({
      id: transactions.id,
      description: transactions.description,
      counterparty: transactions.counterparty,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.merchantId)));

  interface Group {
    normalitzat: string;
    mostrar: string;
    lastDay: string | null;
    ids: number[];
  }
  const byKey = new Map<string, Group>();

  for (const transaction of seus) {
    const [normalitzat, mostrar] = normalizeDescription(
      transaction.description,
      transaction.counterparty,
    );
    if (!normalitzat) continue;

    const key = normalitzat.slice(0, 200);
    const group = byKey.get(key);
    if (group === undefined) {
      byKey.set(key, {
        normalitzat: key,
        mostrar,
        lastDay: transaction.bookingDate,
        ids: [transaction.id],
      });
    } else {
      group.ids.push(transaction.id);
      if (transaction.bookingDate > (group.lastDay ?? ""))
        group.lastDay = transaction.bookingDate;
    }
  }

  for (const group of byKey.values()) {
    const merchant = await getOrCreateMerchant(
      newWorkspace,
      group.normalitzat,
      group.mostrar,
      group.lastDay,
      tx,
    );
    await tx
      .update(transactions)
      .set({ normalizedDescription: group.normalitzat, merchantId: merchant?.id ?? null })
      .where(inArray(transactions.id, group.ids));
  }
}

/**
 * Recounts the transactions of every merchant in the given workspaces.
 *
 * The counter was raised one by one as transactions appeared, and that only
 * holds while none of them move. Recounting is just as cheap and cannot drift:
 * it is what is shown in the merchant list and what orders the local model's
 * queue.
 */
async function boxTheCounters(tx: Tx, workspaces: (number | null)[]): Promise<void> {
  const ids = [...new Set(workspaces.filter((e): e is number => e !== null))];
  if (ids.length === 0) return;

  await tx.execute(sql`
    update merchants
       set transaction_count = coalesce((
             select count(*) from transactions
              where transactions.merchant_id = merchants.id
           ), 0)
     where merchants.ledger_id in ${sql.raw(`(${ids.join(",")})`)}
  `);
}
