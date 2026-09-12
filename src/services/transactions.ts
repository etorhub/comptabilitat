/**
 * Moviments: consulta, vista i emmascarament.
 *
 * **L'emmascarament es una funcio de privadesa i s'aplica aqui, no a la
 * plantilla.** Quan un moviment te `display_description`, aquell text
 * substitueix el concepte del banc, i el comerç i la contrapart no es mostren
 * ni es poden cercar.
 *
 * En una arquitectura de fragments aixo es un risc real: qualsevol plantilla
 * nova que dibuixes una fila crua se'l saltaria sense que ningu se n'adones.
 * Per aixo tot passa per `vistaMoviment()` i **de `routes/` no s'importa mai
 * el tipus de la fila sencera**.
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
 * Un moviment tal com es pot ensenyar.
 *
 * No hi ha ni `raw`, ni `dedupKey`, ni `entryReference`, ni el concepte del
 * banc quan esta emmascarat. Es l'unic tipus que les plantilles accepten.
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
   * El text que es pot ensenyar: l'alias si n'hi ha; si no, el concepte del
   * banc ja parsejat (sense targeta ni comissio).
   */
  description: string;
  /**
   * Text bancari sense PAN/targeta/comissio, per al `title` del boto.
   * Null quan hi ha alias (la dada del banc no s'ensenya).
   */
  descriptionHint: string | null;
  /** Darrers 4 digits de la targeta, o null. Mai amb alias. */
  darrers4: string | null;
  /**
   * Tipus d'operacio deduit del concepte. Null quan hi ha alias (no ensenyem
   * metadades del banc).
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
  /** Cert si algu n'ha amagat el concepte del banc. */
  isMasked: boolean;
  /** Serie recurrent enllaçada via `recurring_occurrences`, si n'hi ha. */
  seriesId: number | null;
  seriesLabel: string | null;
}

/**
 * Columnes explicites. Mai `select()` a seques sobre `transactions`: la fila
 * sencera duu `raw`, que es la resposta del banc amb noms i IBAN.
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
 * La fila tal com surt de la consulta. Les columnes que venen d'un `left
 * join` poden ser nul·les, de manera que s'escriu a ma en lloc de deduir-la
 * de `CAMPS`: deduir-la amagaria justament aquesta nul·litat.
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
 * Converteix una fila en el que es pot ensenyar, aplicant l'emmascarament.
 *
 * **Es l'unica porta.** Si un moviment esta emmascarat, aqui es on el
 * concepte del banc, la contrapart i el comerç desapareixen. Si no, el
 * concepte es parseja nomes per mostrar (sense tocar la BD).
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
  /** Filtre per etiqueta (insensible a majuscules). Null = sense filtre. */
  tag: string | null;
  /** Tipus d'operacio (OR). Buit = tots. */
  operationType: OperationType[];
  /** Darrers 4 digits de targeta (OR). Buit = totes. */
  cards: string[];
  onlyReview: boolean;
  onlyUnclassified: boolean;
  includeTransfers: boolean;
  limit: number;
  offset: number;
}

/** Predicat SQL alineat amb `detectaTipusOperacio` (sobre el concepte cru). */
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
      // `or()` es tipa com a opcional perque accepta zero arguments; aqui n'hi
      // van quatre de fixos, aixi que no pot ser indefinit. Es comprova en
      // lloc d'afirmar-ho amb un `!`.
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
  // Si hi ha tots els tipus, no cal filtrar.
  if (type.length === 5) return undefined;
  return or(...type.map(typePredicate));
}

/** El concepte conte aquests 4 digits com a bloc (no enganxats a mes digits). */
function cardPredicate(v: string): SQL {
  return sql`${transactions.description} ~ ('(^|[^0-9])' || ${v} || '($|[^0-9])')`;
}

function cardClause(cards: string[]): SQL | undefined {
  if (cards.length === 0) return undefined;
  return and(typePredicate("targeta"), or(...cards.map(cardPredicate)));
}

/**
 * Darrers 4 digits de cada targeta feta servir en un compte (o tot el
 * ledger si no se'n dona cap). Es dedueix del concepte, igual que
 * `darrers4` a `vistaMoviment()`: no hi ha cap columna a la BD.
 */
export async function cardsAvailable(
  ledgerId: number,
  accountId: number | null,
): Promise<string[]> {
  const on = and(
    eq(transactions.ledgerId, ledgerId),
    accountId !== null ? eq(transactions.accountId, accountId) : undefined,
    typePredicate("targeta"),
    // Un moviment emmascarat no es pot cercar pel concepte bancari
    // (vistaMoviment): tampoc ha de revelar-hi la targeta.
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
 * Cerca sobre el text **visible**.
 *
 * Un moviment emmascarat no es pot trobar pel concepte del banc ni per la
 * contrapart: nomes per l'alias que hi ha posat una persona i per les notes.
 * Si no fos aixi, es podria endevinar el que s'ha amagat provant paraules.
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
  // Els traspassos entre comptes propis no son ni ingres ni despesa: per
  // defecte no surten.
  if (!f.includeTransfers) parts.push(isNull(transactions.transferGroupId));

  return and(...parts);
}

export interface TransactionsPage {
  items: TransactionView[];
  total: number;
  /** Suma dels moviments que encaixen amb els filtres, no nomes de la pagina. */
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

/** Un moviment d'aquest espai, ja llest per ensenyar, o 404. */
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

/** La fila crua, nomes per als serveis. No arriba mai a cap plantilla. */
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

// --- Safata de revisio -------------------------------------------------------

/** Un moviment per revisar, amb la proposta del model local si n'hi ha. */
export interface ReviewItem {
  transaction: TransactionView;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  confidence: number | null;
  rationale: string;
}

/**
 * La cua de revisio.
 *
 * El model local **no confirma res pel seu compte**: quan proposa una
 * categoria, el moviment queda marcat per revisar amb la seva confiança i la
 * seva justificacio, i qui decideix es una persona.
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

  // La proposta mes recent de cada comerç.
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
    // Si el moviment esta emmascarat, la proposta tambe s'amaga: parla del
    // comerç, que es justament el que no s'ha de veure.
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
