/**
 * Merchant memory.
 *
 * Within a workspace, a merchant is classified **once only**. Nothing is
 * shared between workspaces: the same Mercadona is a different merchant in
 * Personal and in Calella, because each has its own users and its own
 * category plan, and because a merchant's name is often a person's name.
 *
 * A translation of `backend/app/services/merchants.py` and of the
 * `classification.remember_merchant_choice` part.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { categories, merchants, transactions, type Merchant } from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";
import { classifyTransaction } from "./classification.ts";
import { resolveCounterparty } from "./contraparts.ts";

/** Special buckets that used to swallow purchases with «COMISION» at the end. */
const CUBELLS_ESPECIALS = new Set([
  "COMISSIO BANCARIA",
  "REINTEGRO EFECTIU",
  "TRASPAS ENTRE COMPTES",
]);

/** Filters of the merchant list. */
export interface MerchantsFilters {
  search: string;
  onlyUnclassified: boolean;
  onlyUnconfirmed: boolean;
  limit: number;
  offset: number;
}

export interface MerchantView {
  id: number;
  normalizedName: string;
  displayName: string;
  defaultCategoryId: number | null;
  /** The category's name, so as not to do one query per row. */
  categoryName: string | null;
  isConfirmed: boolean;
  transactionCount: number;
  lastSeenAt: string | null;
}

export interface MerchantsPage {
  items: MerchantView[];
  total: number;
  limit: number;
  offset: number;
}

function conditions(ledgerId: number, filters: MerchantsFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(merchants.ledgerId, ledgerId)];

  const search = filters.search.trim();
  if (search) {
    const patro = `%${search}%`;
    parts.push(or(ilike(merchants.normalizedName, patro), ilike(merchants.displayName, patro)));
  }
  if (filters.onlyUnclassified) parts.push(isNull(merchants.defaultCategoryId));
  if (filters.onlyUnconfirmed) parts.push(eq(merchants.isConfirmed, false));

  return and(...parts);
}

/**
 * The workspace's merchants, the most frequent first.
 *
 * Explicit columns are asked for and the category's name is joined in: that
 * way the template has to do no query and never receives the whole row.
 */
export async function listMerchants(
  ledgerId: number,
  filters: MerchantsFilters,
): Promise<MerchantsPage> {
  const on = conditions(ledgerId, filters);

  const [total] = await db.select({ n: count() }).from(merchants).where(on);

  const rows = await db
    .select({
      id: merchants.id,
      normalizedName: merchants.normalizedName,
      displayName: merchants.displayName,
      defaultCategoryId: merchants.defaultCategoryId,
      categoryName: categories.name,
      isConfirmed: merchants.isConfirmed,
      transactionCount: merchants.transactionCount,
      lastSeenAt: merchants.lastSeenAt,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
    .where(on)
    .orderBy(desc(merchants.transactionCount), asc(merchants.normalizedName))
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    items: rows,
    total: total?.n ?? 0,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/** A merchant of this workspace, or 404. */
export async function merchantInWorkspace(id: number, ledgerId: number): Promise<Merchant> {
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, id), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!merchant) throw new NotFoundError("Aquest comerç no existeix");
  return merchant;
}

/** Returns a merchant's view, for redrawing its row. */
export async function merchantView(id: number, ledgerId: number): Promise<MerchantView> {
  const [row] = await db
    .select({
      id: merchants.id,
      normalizedName: merchants.normalizedName,
      displayName: merchants.displayName,
      defaultCategoryId: merchants.defaultCategoryId,
      categoryName: categories.name,
      isConfirmed: merchants.isConfirmed,
      transactionCount: merchants.transactionCount,
      lastSeenAt: merchants.lastSeenAt,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
    .where(and(eq(merchants.id, id), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest comerç no existeix");
  return row;
}

/**
 * Saves a person's decision about a merchant and propagates it within their workspace.
 *
 * Transactions that already have a category set **by a person**
 * (`category_source = 'user'`) are never touched: that decision outranks
 * everything. Returns how many transactions were changed.
 *
 * The two writes go together. If you only do the first, the merchant says
 * «confirmed, category X» and its transactions keep the previous one; and
 * that does not fix itself, because `classifyPending` only picks up
 * transactions with no category or marked for review, and these are neither.
 *
 * `connexio.transaction()` works both for the pool and for a transaction that
 * is already open: inside another one, Postgres just puts a savepoint there.
 * seguretat i prou.
 */
export async function rememberMerchantChoice(
  merchant: Merchant,
  categoryId: number | null,
  aplicaAlsExistents = true,
  connection: Transactor = db,
): Promise<number> {
  return connection.transaction(async (tx) => {
    await tx
      .update(merchants)
      .set({
        defaultCategoryId: categoryId,
        categorySource: "user",
        isConfirmed: true,
      })
      .where(eq(merchants.id, merchant.id));

    if (!aplicaAlsExistents) return 0;

    const canviats = await tx
      .update(transactions)
      .set({
        categoryId,
        categorySource: "merchant",
        categoryConfidence: 1,
        needsReview: false,
      })
      .where(
        and(
          eq(transactions.merchantId, merchant.id),
          // Nothing overwrites a person's decision.
          ne(transactions.categorySource, "user"),
        ),
      )
      .returning({ id: transactions.id });

    return canviats.length;
  });
}

/**
 * Assigns a merchant's default category.
 *
 * The category must belong to this workspace: otherwise transactions could be
 * stuck into another one's books.
 */
export async function assignCategory(
  id: number,
  ledgerId: number,
  categoryId: number | null,
  aplicaAlsExistents = true,
): Promise<number> {
  const merchant = await merchantInWorkspace(id, ledgerId);

  if (categoryId !== null) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)))
      .limit(1);
    if (!category) throw new AppError("La categoria no es d'aquest espai", 422);
  }

  return rememberMerchantChoice(merchant, categoryId, aplicaAlsExistents);
}

/**
 * The merchant of this workspace with this normalized name, creating it if needed.
 *
 * It is used by the synchronization, once per new transaction.
 *
 * @param incrementCounter if false, it only gets or creates without
 *   touching `transaction_count` (for batch reassignments that recount after).
 */
export async function getOrCreateMerchant(
  ledgerId: number,
  normalizedName: string,
  display = "",
  seenOn: string | null = null,
  connection: Transactor = db,
  incrementCounter = true,
): Promise<Merchant | null> {
  const name = (normalizedName || "").trim();
  if (!name) return null;

  const [existing] = await connection
    .select()
    .from(merchants)
    .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.normalizedName, name)))
    .limit(1);

  let merchant = existing;
  if (!merchant) {
    const [creat] = await connection
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: name.slice(0, 200),
        displayName: (display || name).slice(0, 200),
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();
    merchant = creat;
  }
  if (!merchant) return null;

  if (!incrementCounter) {
    if (seenOn !== null && (merchant.lastSeenAt === null || seenOn > merchant.lastSeenAt)) {
      const [withDate] = await connection
        .update(merchants)
        .set({ lastSeenAt: seenOn })
        .where(eq(merchants.id, merchant.id))
        .returning();
      return withDate ?? merchant;
    }
    return merchant;
  }

  const seenLast =
    seenOn !== null && (merchant.lastSeenAt === null || seenOn > merchant.lastSeenAt)
      ? seenOn
      : merchant.lastSeenAt;

  const [actualitzat] = await connection
    .update(merchants)
    .set({ transactionCount: merchant.transactionCount + 1, lastSeenAt: seenLast })
    .where(eq(merchants.id, merchant.id))
    .returning();

  return actualitzat ?? merchant;
}

/** Recounts `transaction_count` from the real transactions. */
export async function countMerchants(
  merchantIds: number[],
  connection: Transactor = db,
): Promise<void> {
  const ids = [...new Set(merchantIds.filter((id) => id > 0))];
  if (ids.length === 0) return;

  const recomptes = await connection
    .select({ merchantId: transactions.merchantId, n: count() })
    .from(transactions)
    .where(inArray(transactions.merchantId, ids))
    .groupBy(transactions.merchantId);

  const perId = new Map(recomptes.map((r) => [r.merchantId, Number(r.n)]));
  for (const id of ids) {
    await connection
      .update(merchants)
      .set({ transactionCount: perId.get(id) ?? 0 })
      .where(eq(merchants.id, id));
  }
}

export interface ReassignmentResult {
  revisats: number;
  canviats: number;
}

/**
 * Renormalizes the transactions and corrects wrongly assigned merchants.
 *
 * A maintenance pass after changing the normalization (accidental commission,
 * empty prefix). It never touches `category_source = 'user'`.
 */
export async function reassignNormalization(
  ledgerId?: number,
  connection: Transactor = db,
): Promise<ReassignmentResult> {
  const rows = await connection
    .select({
      id: transactions.id,
      ledgerId: transactions.ledgerId,
      description: transactions.description,
      counterparty: transactions.counterparty,
      normalizedDescription: transactions.normalizedDescription,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      amount: transactions.amount,
      bankTransactionCode: transactions.bankTransactionCode,
      accountId: transactions.accountId,
      tags: transactions.tags,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .where(ledgerId === undefined ? undefined : eq(transactions.ledgerId, ledgerId));

  let canviats = 0;
  const merchantsTocats = new Set<number>();

  for (const transaction of rows) {
    let newMerchantId: number | null = null;
    let newKey = "";

    if (transaction.ledgerId !== null) {
      const counterparty = await resolveCounterparty(
        transaction.ledgerId,
        {
          description: transaction.description,
          counterparty: transaction.counterparty,
          bookingDate: transaction.bookingDate,
        },
        connection,
        false,
      );
      newMerchantId = counterparty.merchantId;
      newKey = counterparty.normalizedKey.slice(0, 200);
    }

    const mustChangeKey = newKey !== transaction.normalizedDescription;
    const keepsCounterparty = newMerchantId === transaction.merchantId;

    if (!mustChangeKey && keepsCounterparty) continue;

    canviats += 1;
    if (transaction.merchantId !== null) merchantsTocats.add(transaction.merchantId);
    if (newMerchantId !== null) merchantsTocats.add(newMerchantId);

    await connection
      .update(transactions)
      .set({
        normalizedDescription: newKey,
        merchantId: newMerchantId,
      })
      .where(eq(transactions.id, transaction.id));

    if (transaction.categorySource === "user") continue;
    if (transaction.ledgerId === null) continue;

    // If it came from a special bucket (or the key changed), classify it again.
    const cameFromBucket =
      transaction.categorySource === "merchant" &&
      CUBELLS_ESPECIALS.has(transaction.normalizedDescription);

    if (!mustChangeKey && !cameFromBucket && keepsCounterparty) {
      continue;
    }

    await classifyTransaction(
      {
        id: transaction.id,
        ledgerId: transaction.ledgerId,
        merchantId: newMerchantId,
        // We force a fresh decision: the bucket's category is removed.
        categorySource: "none",
      },
      connection,
    );
  }

  await countMerchants([...merchantsTocats], connection);
  return { revisats: rows.length, canviats };
}
