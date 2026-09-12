/**
 * Assignacio de categoria als moviments d'un espai.
 *
 * L'ordre de resolucio es sempre el mateix, del mes barat i explicit al mes
 * car:
 *
 *   1. **la decisio d'una persona, que no es toca mai**;
 *   2. la memoria de comerços de l'espai;
 *   3. el que queda, pendent de revisar.
 *
 * Tot passa dins d'un sol espai: res del que es decideix aqui afecta els
 * altres. Traduccio de `backend/app/services/classification.py` (sense el
 * pas de regles, que s'ha tret del producte).
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
  perComerc: number;
  pending: number;
}

export function summaryStats(s: ClassificationStats): string {
  return `${s.perComerc} per comerç, ${s.pending} pendents de revisar`;
}

/** El moviment tal com el necessita la classificacio. */
interface ClassifiableTransaction {
  id: number;
  ledgerId: number | null;
  merchantId: number | null;
  categorySource: CategorySource;
}

/**
 * Classifica un moviment. **No toca mai el que ha decidit una persona.**
 *
 * Retorna d'on ha sortit la categoria. Escriu directament a la base de dades,
 * de manera que es pot cridar dins d'una transaccio.
 */
export async function classifyTransaction(
  transaction: ClassifiableTransaction,
  connection: Transactor = db,
): Promise<CategorySource> {
  if (transaction.categorySource === "user") return "user";

  // Un compte encara sense espai assignat no te categories.
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
          // Si el comerç l'ha confirmat una persona, ens en refiem del tot;
          // si no, es una suposicio i algu l'ha de mirar.
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

/** Els camps que la classificacio necessita d'un moviment. */
const FIELDS_CLASSIFICATION = {
  id: transactions.id,
  ledgerId: transactions.ledgerId,
  merchantId: transactions.merchantId,
  categorySource: transactions.categorySource,
} as const;

/**
 * Classifica els moviments d'un espai que encara no tenen categoria.
 *
 * Nomes mira els que venen de `none` o de `merchant`: els que ha posat una
 * persona no es toquen.
 */
export async function classifyPending(
  ledgerId: number,
  limit?: number,
): Promise<ClassificationStats> {
  const stats: ClassificationStats = {
    perComerc: 0,
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
    if (origin === "merchant") stats.perComerc += 1;
    else stats.pending += 1;
  }

  return stats;
}

/** Una categoria de l'espai pel seu pendent estable. */
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
 * La categoria dels traspassos interns. Si algu l'ha canviat de tipus, no
 * serveix: val mes no aparellar res que aparellar-ho malament.
 */
export async function transferCategory(ledgerId: number, connection: Transactor = db) {
  const category = await categoryBySlug(ledgerId, SLUG_INTERNAL_TRANSFER, connection);
  if (category !== null && category.kind !== "transfer") return null;
  return category;
}
