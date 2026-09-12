/**
 * Memoria de comerços.
 *
 * Dins d'un espai, un comerç es classifica **una sola vegada**. Entre espais
 * no es comparteix res: el mateix Mercadona es un comerç diferent a Personal i
 * a Calella, perque cadascun te els seus usuaris i el seu pla de categories, i
 * perque el nom d'un comerç sovint es el nom d'una persona.
 *
 * Traduccio de `backend/app/services/merchants.py` i de la part de
 * `classification.remember_merchant_choice`.
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

/** Cubells especials que abans engolien compres amb «COMISION» al final. */
const CUBELLS_ESPECIALS = new Set([
  "COMISSIO BANCARIA",
  "REINTEGRO EFECTIU",
  "TRASPAS ENTRE COMPTES",
]);

/** Filtres de la llista de comerços. */
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
  /** El nom de la categoria, per no fer una consulta per fila. */
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

function condicions(ledgerId: number, filters: MerchantsFilters): SQL | undefined {
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
 * Els comerços de l'espai, els que mes surten primer.
 *
 * Es demanen columnes explicites i s'hi ajunta el nom de la categoria: aixi la
 * plantilla no ha de fer cap consulta ni rep mai la fila sencera.
 */
export async function listMerchants(
  ledgerId: number,
  filters: MerchantsFilters,
): Promise<MerchantsPage> {
  const on = condicions(ledgerId, filters);

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

/** Un comerç d'aquest espai, o 404. */
export async function merchantInWorkspace(id: number, ledgerId: number): Promise<Merchant> {
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, id), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!merchant) throw new NotFoundError("Aquest comerç no existeix");
  return merchant;
}

/** Torna la vista d'un comerç, per redibuixar-ne la fila. */
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
 * Desa la decisio d'una persona sobre un comerç i la propaga dins del seu espai.
 *
 * Els moviments que ja tenen categoria posada **per una persona**
 * (`category_source = 'user'`) no es toquen mai: aquella decisio mana per
 * sobre de tot. Retorna quants moviments s'han canviat.
 *
 * Les dues escriptures van juntes. Si nomes passes la primera, el comerç diu
 * «confirmat, categoria X» i els seus moviments continuen amb la d'abans; i
 * aixo no s'adoba sol, perque `classificaPendents` nomes recull els moviments
 * sense categoria o marcats per revisar, i aquests no en son cap dels dos.
 *
 * `connexio.transaction()` val tant per a la piscina com per a una transaccio
 * que ja estigui oberta: dins d'una altra, Postgres hi posa un punt de
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
          // La decisio d'una persona no la sobreescriu res.
          ne(transactions.categorySource, "user"),
        ),
      )
      .returning({ id: transactions.id });

    return canviats.length;
  });
}

/**
 * Assigna la categoria per defecte d'un comerç.
 *
 * La categoria ha de ser d'aquest espai: si no, s'hi podrien enganxar
 * moviments a la comptabilitat d'un altre.
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
 * El comerç d'aquest espai amb aquest nom normalitzat, creant-lo si cal.
 *
 * La fa servir la sincronitzacio, un cop per moviment nou.
 *
 * @param incrementaComptador si es fals, nomes obté o crea sense tocar
 *   `transaction_count` (per a reassignacions en lot que després recompten).
 */
export async function getOrCreateMerchant(
  ledgerId: number,
  normalizedName: string,
  display = "",
  seenOn: string | null = null,
  connection: Transactor = db,
  incrementaComptador = true,
): Promise<Merchant | null> {
  const name = (normalizedName || "").trim();
  if (!name) return null;

  const [existent] = await connection
    .select()
    .from(merchants)
    .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.normalizedName, name)))
    .limit(1);

  let merchant = existent;
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

  if (!incrementaComptador) {
    if (seenOn !== null && (merchant.lastSeenAt === null || seenOn > merchant.lastSeenAt)) {
      const [ambData] = await connection
        .update(merchants)
        .set({ lastSeenAt: seenOn })
        .where(eq(merchants.id, merchant.id))
        .returning();
      return ambData ?? merchant;
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

/** Recompta `transaction_count` a partir dels moviments reals. */
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
 * Torna a normalitzar els moviments i corregeix comerços mal assignats.
 *
 * Una passada de manteniment després de canviar la normalitzacio (comissio
 * accidental, prefix buit). No toca mai `category_source = 'user'`.
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

    // Si venia d'un cubell especial (o la clau ha canviat), torna a classificar.
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
        // Forcem que es torni a decidir: treiem la categoria del cubell.
        categorySource: "none",
      },
      connection,
    );
  }

  await countMerchants([...merchantsTocats], connection);
  return { revisats: rows.length, canviats };
}
