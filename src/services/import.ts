/**
 * Downloading the bank's transactions and saving them.
 *
 * The two things that make importing twice harmless:
 *
 *   1. **The deduplication key** (`dedupKey`), which recognizes what is
 *      already there.
 *   2. **Reconciling the pending entries**: when a pending entry is booked,
 *      the same row is reused instead of making a new one, so that the
 *      category a person has set is kept.
 *
 */

import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, balances, transactions, type Account } from "../db/schema/index.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { DateRangeError } from "../lib/enablebanking/errors.ts";
import {
  dedupKey,
  parseBalance,
  parseTransaction,
  type TransactionAnalyzed,
} from "../lib/enablebanking/parsing.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { classifyTransaction } from "./classification.ts";
import { resolveCounterparty } from "./contraparts.ts";

/** Margin for matching a pending entry with its final booked one. */
const PENDING_MATCH_DAYS = 5;
/** Alternative windows (in months) when the bank rejects the period asked for. */
const FALLBACK_WINDOWS_MONTHS = [24, 12, 6, 3, 1];

export interface AccountResult {
  accountId: number;
  inserted: number;
  updatedCount: number;
  deletedRows: number;
  error: string;
}

/** The start date of a window that many months back. */
export function startDateMonthsAgo(months: number): string {
  return addDays(todayLocal(), -Math.round(months * 30.4));
}

// --- Import -------------------------------------------------------------------

/**
 * Downloads the transactions, shortening the window if the bank rejects it.
 *
 * Santander does not always accept 24 months; when it says no, 12, 6, 3 and 1
 * are tried, and which one got through is written in the log.
 */
export async function removeTransactions(
  client: EnableBankingClient,
  account: Account,
  dateFrom: string,
): Promise<{ items: TransactionAnalyzed[]; used: string; truncated: boolean }> {
  const windows = [dateFrom];
  for (const months of FALLBACK_WINDOWS_MONTHS) {
    const candidateRow = startDateMonthsAgo(months);
    if (candidateRow > dateFrom && !windows.includes(candidateRow)) windows.push(candidateRow);
  }

  let lastError: DateRangeError | null = null;

  for (const candidateRow of windows) {
    try {
      const items: TransactionAnalyzed[] = [];
      // It is iterated by hand so that the generator's return value can be
      // read, which says whether the list came up short.
      const pages = client.iterTransactions(account.ebAccountUid, { dateFrom: candidateRow });
      let step = await pages.next();
      while (step.done !== true) {
        const analyzed = parseTransaction(step.value);
        if (analyzed !== null) items.push(analyzed);
        step = await pages.next();
      }
      return { items, used: candidateRow, truncated: step.value };
    } catch (error) {
      if (error instanceof DateRangeError) {
        console.warn(
          `[sync] compte ${account.id}: el banc rebutja la finestra des de ${candidateRow} (${error.message})`,
        );
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new DateRangeError("Cap finestra de dates acceptada");
}

/** Fields the bank can change on a transaction we already had. */
function needsUpdate(
  actual: {
    status: string;
    bookingDate: string;
    valueDate: string | null;
    amount: string;
    description: string;
    counterparty: string;
  },
  fresh: TransactionAnalyzed,
): boolean {
  return (
    actual.status !== fresh.status ||
    actual.bookingDate !== fresh.bookingDate ||
    actual.valueDate !== fresh.valueDate ||
    actual.amount !== fresh.amount ||
    actual.description !== fresh.description ||
    actual.counterparty !== fresh.counterparty
  );
}

/**
 * Saves an account's transactions.
 *
 * Here is the reconciliation of the pending entries: a pending entry that is
 * booked **reuses the row that was already there**, so that the category a
 * person has set is not lost.
 */
export async function saveTransactions(
  account: Account,
  items: TransactionAnalyzed[],
  /** If the bank did not give everything, nothing can be deduced from what is missing. */
  incompleteList = false,
): Promise<AccountResult> {
  const result: AccountResult = {
    accountId: account.id,
    inserted: 0,
    updatedCount: 0,
    deletedRows: 0,
    error: "",
  };
  if (items.length === 0) return result;

  const minDate = items.reduce((a, b) => (a.bookingDate < b.bookingDate ? a : b)).bookingDate;
  const windowStart = addDays(minDate, -PENDING_MATCH_DAYS);

  const existing = await db
    .select({
      id: transactions.id,
      dedupKey: transactions.dedupKey,
      status: transactions.status,
      bookingDate: transactions.bookingDate,
      valueDate: transactions.valueDate,
      amount: transactions.amount,
      description: transactions.description,
      counterparty: transactions.counterparty,
    })
    .from(transactions)
    .where(
      and(eq(transactions.accountId, account.id), gte(transactions.bookingDate, windowStart)),
    );

  const byKey = new Map(existing.map((e) => [e.dedupKey, e]));
  let pending = existing.filter((e) => e.status === "pending");
  const views = new Set<string>();

  for (const item of items) {
    const key = dedupKey(item);
    views.add(key);

    const actual = byKey.get(key);
    if (actual !== undefined) {
      if (needsUpdate(actual, item)) {
        await db
          .update(transactions)
          .set({
            status: item.status,
            bookingDate: item.bookingDate,
            valueDate: item.valueDate,
            amount: item.amount,
            description: item.description,
            counterparty: item.counterparty,
            raw: item.raw,
          })
          .where(eq(transactions.id, actual.id));
        result.updatedCount += 1;
      }
      continue;
    }

    // A pending entry that is booked must not be duplicated.
    if (item.status === "booked") {
      const matched = pending.find(
        (p) =>
          p.amount === item.amount &&
          Math.abs(daysBetween(p.bookingDate, item.bookingDate)) <= PENDING_MATCH_DAYS,
      );

      if (matched !== undefined) {
        pending = pending.filter((p) => p.id !== matched.id);
        byKey.delete(matched.dedupKey);

        await db
          .update(transactions)
          .set({
            dedupKey: key,
            entryReference: item.entryReference,
            transactionId: item.transactionId,
            status: item.status,
            bookingDate: item.bookingDate,
            valueDate: item.valueDate,
            amount: item.amount,
            description: item.description,
            counterparty: item.counterparty,
            raw: item.raw,
          })
          .where(eq(transactions.id, matched.id));

        byKey.set(key, { ...matched, dedupKey: key });
        result.updatedCount += 1;
        continue;
      }
    }

    const [createdOne] = await db
      .insert(transactions)
      .values({
        accountId: account.id,
        ledgerId: account.ledgerId,
        entryReference: item.entryReference,
        transactionId: item.transactionId,
        dedupKey: key,
        source: "enablebanking",
        bookingDate: item.bookingDate,
        valueDate: item.valueDate,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        description: item.description,
        normalizedDescription: "",
        counterparty: item.counterparty,
        bankTransactionCode: item.bankTransactionCode,
        merchantId: null,
        categoryId: null,
        categorySource: "none",
        categoryConfidence: null,
        needsReview: false,
        appliedRuleId: null,
        transferGroupId: null,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: item.raw,
      })
      .returning({ id: transactions.id });

    if (!createdOne) continue;

    // Normalized name, merchant and category.
    let merchantId: number | null = null;
    let normalized = "";

    if (account.ledgerId !== null) {
      const counterparty = await resolveCounterparty(account.ledgerId, {
        description: item.description,
        counterparty: item.counterparty,
        bookingDate: item.bookingDate,
      });
      merchantId = counterparty.merchantId;
      normalized = counterparty.normalizedKey;
    }

    await db
      .update(transactions)
      .set({ normalizedDescription: normalized.slice(0, 200), merchantId })
      .where(eq(transactions.id, createdOne.id));

    await classifyTransaction({
      id: createdOne.id,
      ledgerId: account.ledgerId,
      merchantId,
      categorySource: "none",
    });

    byKey.set(key, {
      id: createdOne.id,
      dedupKey: key,
      status: item.status,
      bookingDate: item.bookingDate,
      valueDate: item.valueDate,
      amount: item.amount,
      description: item.description,
      counterparty: item.counterparty,
    });
    result.inserted += 1;
  }

  // The pending entries the bank no longer reports have disappeared. This can
  // only be deduced if the bank gave **everything**: with a truncated list,
  // «it is not there» means «it did not arrive», and we would delete live
  // transactions along with their notes, tags and whatever category was set.
  const expired = incompleteList
    ? []
    : pending.filter((p) => !views.has(p.dedupKey) && p.bookingDate >= windowStart);
  if (expired.length > 0) {
    await db.delete(transactions).where(
      inArray(
        transactions.id,
        expired.map((p) => p.id),
      ),
    );
    result.deletedRows = expired.length;
  }

  // How far we got.
  const booked = items.filter((i) => i.status === "booked").map((i) => i.bookingDate);
  const changes: Partial<typeof accounts.$inferInsert> = {};

  if (booked.length > 0) {
    const newer = booked.reduce((a, b) => (a > b ? a : b));
    if (account.lastBookedDate === null || newer > account.lastBookedDate) {
      changes.lastBookedDate = newer;
    }
  }
  const older = items.reduce((a, b) => (a.bookingDate < b.bookingDate ? a : b)).bookingDate;
  if (account.historyStartDate === null || older < account.historyStartDate) {
    changes.historyStartDate = older;
  }
  if (Object.keys(changes).length > 0) {
    await db.update(accounts).set(changes).where(eq(accounts.id, account.id));
  }

  return result;
}

export async function saveBalances(
  client: EnableBankingClient,
  account: Account,
): Promise<void> {
  const now = new Date();

  for (const raw of await client.getBalances(account.ebAccountUid)) {
    const data = parseBalance(raw);
    if (data === null || data.referenceDate === null) continue;

    const [ja] = await db
      .select({ id: balances.id })
      .from(balances)
      .where(
        and(
          eq(balances.accountId, account.id),
          eq(balances.balanceType, data.balanceType),
          eq(balances.referenceDate, data.referenceDate),
        ),
      )
      .limit(1);

    if (ja) {
      await db
        .update(balances)
        .set({ amount: data.amount, fetchedAt: now })
        .where(eq(balances.id, ja.id));
    } else {
      await db.insert(balances).values({
        accountId: account.id,
        balanceType: data.balanceType,
        amount: data.amount,
        currency: data.currency,
        referenceDate: data.referenceDate,
        fetchedAt: now,
      });
    }
  }
}
