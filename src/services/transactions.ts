/**
 * Transactions: query, view and masking.
 *
 * **Masking is a privacy feature and is applied here, not in the template.**
 * When a transaction has `display_description`, that text replaces the bank's
 * concept, and the merchant and the counterparty are neither shown nor
 * searchable.
 *
 * In a fragment architecture this is a real risk: any new template that drew
 * a raw row would skip it without anyone noticing. That is why everything
 * goes through `transactionView()` and **the type of the whole row is never
 * imported from `routes/`**.
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";

import { parseDescription, type OperationType } from "./concepte.ts";
import { hasTag } from "./tags.ts";

import { db } from "../db/client.ts";
import {
  accounts,
  categories,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type CategorySource,
  type TransactionStatus,
} from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import type { MoneyString } from "../lib/money.ts";

/**
 * A transaction as it can be shown.
 *
 * There is no `raw`, no `dedupKey`, no `entryReference`, and no bank concept
 * when it is masked. It is the only type the templates accept.
 */
export interface TransactionView {
  id: number;
  accountId: number;
  accountName: string | null;
  bookingDate: string;
  valueDate: string | null;
  amount: MoneyString;
  currency: string;
  status: TransactionStatus;
  /**
   * The text that can be shown: the alias if there is one; otherwise the
   * bank's concept already parsed (without card or commission).
   */
  description: string;
  /**
   * Bank text without PAN/card/commission, for the button's `title`.
   * Null when there is an alias (the bank's data is not shown).
   */
  descriptionHint: string | null;
  /** Last 4 digits of the card, or null. Never with an alias. */
  darrers4: string | null;
  /**
   * Operation type deduced from the concept. Null when there is an alias (we
   * do not show the bank's metadata).
   */
  operationType: OperationType | null;
  counterparty: string;
  merchantId: number | null;
  merchantName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  needsReview: boolean;
  transferGroupId: string | null;
  notes: string;
  tags: string[];
  isExcluded: boolean;
  /** True if someone has hidden the bank's concept. */
  isMasked: boolean;
  /** Recurring series linked via `recurring_occurrences`, if any. */
  seriesId: number | null;
  seriesLabel: string | null;
}

/**
 * Explicit columns. Never a bare `select()` over `transactions`: the whole
 * row carries `raw`, which is the bank's response with names and IBAN.
 */
const Fields = {
  id: transactions.id,
  accountId: transactions.accountId,
  accountName: accounts.name,
  bookingDate: transactions.bookingDate,
  valueDate: transactions.valueDate,
  amount: transactions.amount,
  currency: transactions.currency,
  status: transactions.status,
  description: transactions.description,
  displayDescription: transactions.displayDescription,
  normalizedDescription: transactions.normalizedDescription,
  counterparty: transactions.counterparty,
  merchantId: transactions.merchantId,
  merchantName: merchants.displayName,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categorySource: transactions.categorySource,
  categoryConfidence: transactions.categoryConfidence,
  needsReview: transactions.needsReview,
  transferGroupId: transactions.transferGroupId,
  notes: transactions.notes,
  tags: transactions.tags,
  isExcluded: transactions.isExcluded,
  seriesId: recurringSeries.id,
  seriesLabel: recurringSeries.label,
} as const;

/**
 * The row as it comes out of the query. Columns coming from a `left join`
 * can be null, so it is written by hand instead of being derived from
 * `CAMPS`: deriving it would hide exactly that nullability.
 */
interface RawRow {
  id: number;
  accountId: number;
  accountName: string | null;
  bookingDate: string;
  valueDate: string | null;
  amount: string;
  currency: string;
  status: TransactionStatus;
  description: string;
  displayDescription: string | null;
  normalizedDescription: string;
  counterparty: string;
  merchantId: number | null;
  merchantName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  needsReview: boolean;
  transferGroupId: string | null;
  notes: string;
  tags: string[];
  isExcluded: boolean;
  seriesId: number | null;
  seriesLabel: string | null;
}

/**
 * Turns a row into what can be shown, applying the masking.
 *
 * **It is the only door.** If a transaction is masked, this is where the
 * bank's concept, the counterparty and the merchant disappear. If it is not,
 * the concept is parsed for display only (without touching the DB).
 */
export function transactionView(row: RawRow): TransactionView {
  const emmascarat = row.displayDescription !== null && row.displayDescription !== "";

  if (emmascarat) {
    return {
      id: row.id,
      accountId: row.accountId,
      accountName: row.accountName,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      description: row.displayDescription ?? "",
      descriptionHint: null,
      darrers4: null,
      operationType: null,
      counterparty: "",
      merchantId: row.merchantId,
      merchantName: null,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categorySource: row.categorySource,
      categoryConfidence: row.categoryConfidence,
      needsReview: row.needsReview,
      transferGroupId: row.transferGroupId,
      notes: row.notes,
      tags: row.tags,
      isExcluded: row.isExcluded,
      isMasked: true,
      seriesId: row.seriesId,
      seriesLabel: row.seriesLabel,
    };
  }

  const parsed = parseDescription(row.description);
  const hint = parsed.cleanedOriginal !== parsed.title ? parsed.cleanedOriginal : null;

  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.accountName,
    bookingDate: row.bookingDate,
    valueDate: row.valueDate,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    description: parsed.title,
    descriptionHint: hint,
    darrers4: parsed.darrers4,
    operationType: parsed.type,
    counterparty: row.counterparty,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categorySource: row.categorySource,
    categoryConfidence: row.categoryConfidence,
    needsReview: row.needsReview,
    transferGroupId: row.transferGroupId,
    notes: row.notes,
    tags: row.tags,
    isExcluded: row.isExcluded,
    isMasked: false,
    seriesId: row.seriesId,
    seriesLabel: row.seriesLabel,
  };
}

export interface TransactionsFilters {
  accountId: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  categoryIds: number[];
  merchantId: number | null;
  search: string;
  /** Tag filter (case-insensitive). Null = no filter. */
  tag: string | null;
  /** Operation type (OR). Empty = all. */
  operationType: OperationType[];
  /** Last 4 digits of the card (OR). Empty = all. */
  cards: string[];
  onlyReview: boolean;
  onlyUnclassified: boolean;
  includeTransfers: boolean;
  limit: number;
  offset: number;
}

/** SQL predicate aligned with `detectOperationType` (over the raw concept). */
function typePredicate(type: OperationType): SQL {
  const description = transactions.description;
  switch (type) {
    case "targeta":
      return sql`(
        ${description} ~* '^(COMPRA|PAGO[[:space:]]+(MOVIL|CON[[:space:]]+MOVIL|TARJETA|EN)[[:space:]])'
        OR ${description} ~* '\\yTARJ'
      )`;
    case "transferencia":
      return sql`(
        ${description} ILIKE 'TRANSFERENCIA%'
        OR ${description} ILIKE 'TRANSF %'
        OR ${description} ILIKE 'TRANSF.%'
      )`;
    case "bizum":
      return sql`(
        ${description} ILIKE 'BIZUM%'
        OR ${description} ILIKE 'ENVIO BIZUM%'
      )`;
    case "rebut":
      return sql`(
        ${description} ILIKE 'RECIBO%'
        OR ${description} ILIKE 'ADEUDO%'
      )`;
    case "altres": {
      // `or()` is typed as optional because it accepts zero arguments; here it
      // gets four fixed ones, so it cannot be undefined. It is checked instead
      // of being asserted with a `!`.
      const algun = or(
        typePredicate("targeta"),
        typePredicate("transferencia"),
        typePredicate("bizum"),
        typePredicate("rebut"),
      );
      if (algun === undefined) throw new Error("predicatTipus: cap predicat");
      return not(algun);
    }
  }
}

function typeClause(type: OperationType[]): SQL | undefined {
  if (type.length === 0) return undefined;
  // If every type is selected, there is nothing to filter.
  if (type.length === 5) return undefined;
  return or(...type.map(typePredicate));
}

/** The concept contains these 4 digits as a block (not glued to more digits). */
function cardPredicate(v: string): SQL {
  return sql`${transactions.description} ~ ('(^|[^0-9])' || ${v} || '($|[^0-9])')`;
}

function cardClause(cards: string[]): SQL | undefined {
  if (cards.length === 0) return undefined;
  return and(typePredicate("targeta"), or(...cards.map(cardPredicate)));
}

/**
 * Last 4 digits of every card used in an account (or in the whole ledger if
 * none is given). It is deduced from the concept, just like `darrers4` in
 * `transactionView()`: there is no column in the DB.
 */
export async function cardsAvailable(
  ledgerId: number,
  accountId: number | null,
): Promise<string[]> {
  const on = and(
    eq(transactions.ledgerId, ledgerId),
    accountId !== null ? eq(transactions.accountId, accountId) : undefined,
    typePredicate("targeta"),
    // A masked transaction cannot be searched by the bank's concept
    // (transactionView): it must not reveal the card there either.
    or(isNull(transactions.displayDescription), eq(transactions.displayDescription, "")),
  );
  const rows = await db
    .selectDistinct({ description: transactions.description })
    .from(transactions)
    .where(on);

  const trobades = new Set<string>();
  for (const f of rows) {
    const { darrers4 } = parseDescription(f.description);
    if (darrers4) trobades.add(darrers4);
  }
  return [...trobades].toSorted();
}

/**
 * Search over the **visible** text.
 *
 * A masked transaction cannot be found by the bank's concept or by the
 * counterparty: only by the alias a person has set and by the notes.
 * Otherwise what has been hidden could be guessed by trying words.
 */
function searchClause(patro: string): SQL | undefined {
  return or(
    and(
      isNotNull(transactions.displayDescription),
      or(ilike(transactions.displayDescription, patro), ilike(transactions.notes, patro)),
    ),
    and(
      isNull(transactions.displayDescription),
      or(
        ilike(transactions.description, patro),
        ilike(transactions.normalizedDescription, patro),
        ilike(transactions.counterparty, patro),
        ilike(transactions.notes, patro),
      ),
    ),
  );
}

function condicions(ledgerId: number, f: TransactionsFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(transactions.ledgerId, ledgerId)];

  if (f.accountId !== null) parts.push(eq(transactions.accountId, f.accountId));
  if (f.dateFrom) parts.push(gte(transactions.bookingDate, f.dateFrom));
  if (f.dateTo) parts.push(lte(transactions.bookingDate, f.dateTo));
  if (f.categoryIds.length > 0) parts.push(inArray(transactions.categoryId, f.categoryIds));
  if (f.merchantId !== null) parts.push(eq(transactions.merchantId, f.merchantId));
  if (f.search.trim()) parts.push(searchClause(`%${f.search.trim()}%`));
  if (f.tag) parts.push(hasTag(f.tag));
  parts.push(typeClause(f.operationType));
  parts.push(cardClause(f.cards));
  if (f.onlyReview) parts.push(eq(transactions.needsReview, true));
  if (f.onlyUnclassified) parts.push(isNull(transactions.categoryId));
  // Transfers between the owner's own accounts are neither income nor
  // expense: by default they are not listed.
  if (!f.includeTransfers) parts.push(isNull(transactions.transferGroupId));

  return and(...parts);
}

export interface TransactionsPage {
  items: TransactionView[];
  total: number;
  /** Sum of the transactions matching the filters, not just of the page. */
  totalAmount: MoneyString;
  limit: number;
  offset: number;
}

export async function listTransactions(
  ledgerId: number,
  filters: TransactionsFilters,
): Promise<TransactionsPage> {
  const on = condicions(ledgerId, filters);

  const [summary] = await db
    .select({ n: count(), total: sum(transactions.amount) })
    .from(transactions)
    .where(on);

  const rows = await db
    .select(Fields)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(recurringOccurrences, eq(recurringOccurrences.transactionId, transactions.id))
    .leftJoin(recurringSeries, eq(recurringSeries.id, recurringOccurrences.seriesId))
    .where(on)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    items: rows.map(transactionView),
    total: summary?.n ?? 0,
    totalAmount: summary?.total ?? "0.00",
    limit: filters.limit,
    offset: filters.offset,
  };
}

/** A transaction of this workspace, ready to show, or 404. */
export async function transactionInWorkspace(
  id: number,
  ledgerId: number,
): Promise<TransactionView> {
  const [row] = await db
    .select(Fields)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(recurringOccurrences, eq(recurringOccurrences.transactionId, transactions.id))
    .leftJoin(recurringSeries, eq(recurringSeries.id, recurringOccurrences.seriesId))
    .where(and(eq(transactions.id, id), eq(transactions.ledgerId, ledgerId)))
    .limit(1);

  if (!row) throw new NotFoundError("Aquest moviment no existeix");
  return transactionView(row);
}

/** The raw row, for the services only. It never reaches any template. */
export async function transactionRow(id: number, ledgerId: number) {
  const [row] = await db
    .select({
      id: transactions.id,
      ledgerId: transactions.ledgerId,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      normalizedDescription: transactions.normalizedDescription,
      counterparty: transactions.counterparty,
      transferGroupId: transactions.transferGroupId,
      displayDescription: transactions.displayDescription,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.ledgerId, ledgerId)))
    .limit(1);

  if (!row) throw new NotFoundError("Aquest moviment no existeix");
  return row;
}

// --- Review tray -------------------------------------------------------------

/** A transaction to review, with the local model's proposal if there is one. */
export interface ReviewItem {
  transaction: TransactionView;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  confidence: number | null;
  rationale: string;
}

/**
 * The review queue.
 *
 * The local model **confirms nothing on its own**: when it proposes a
 * category, the transaction is marked for review with its confidence and its
 * justification, and a person is the one who decides.
 */
export async function reviewQueue(
  ledgerId: number,
  limit = 50,
  offset = 0,
): Promise<{ items: ReviewItem[]; total: number }> {
  const on = and(eq(transactions.ledgerId, ledgerId), eq(transactions.needsReview, true));

  const [summary] = await db.select({ n: count() }).from(transactions).where(on);

  const rows = await db
    .select(Fields)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(recurringOccurrences, eq(recurringOccurrences.transactionId, transactions.id))
    .leftJoin(recurringSeries, eq(recurringSeries.id, recurringOccurrences.seriesId))
    .where(on)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(limit)
    .offset(offset);

  const merchantIds = [
    ...new Set(rows.map((f) => f.merchantId).filter((x): x is number => x !== null)),
  ];

  // The most recent proposal of each merchant.
  const proposals = new Map<
    number,
    {
      categoryId: number | null;
      categoryName: string | null;
      confidence: number | null;
      rationale: string;
    }
  >();
  if (merchantIds.length > 0) {
    const { llmSuggestions } = await import("../db/schema/index.ts");
    const suggeriments = await db
      .select({
        merchantId: llmSuggestions.merchantId,
        categoryId: llmSuggestions.suggestedCategoryId,
        categoryName: categories.name,
        confidence: llmSuggestions.confidence,
        rationale: llmSuggestions.rationale,
      })
      .from(llmSuggestions)
      .leftJoin(categories, eq(categories.id, llmSuggestions.suggestedCategoryId))
      .where(inArray(llmSuggestions.merchantId, merchantIds))
      .orderBy(llmSuggestions.createdAt);

    for (const s of suggeriments) {
      if (s.merchantId === null) continue;
      proposals.set(s.merchantId, {
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        confidence: s.confidence,
        rationale: s.rationale,
      });
    }
  }

  const items = rows.map((row) => {
    const transaction = transactionView(row);
    // If the transaction is masked, the proposal is hidden too: it talks about
    // the merchant, which is exactly what must not be seen.
    const proposal = transaction.isMasked
      ? undefined
      : row.merchantId !== null
        ? proposals.get(row.merchantId)
        : undefined;

    return {
      transaction,
      suggestedCategoryId: proposal?.categoryId ?? null,
      suggestedCategoryName: proposal?.categoryName ?? null,
      confidence: proposal?.confidence ?? null,
      rationale: proposal?.rationale ?? "",
    };
  });

  return { items, total: summary?.n ?? 0 };
}
