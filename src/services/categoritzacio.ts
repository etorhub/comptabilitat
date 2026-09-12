/**
 * Posar categoria a un moviment perque ho ha dit una persona.
 *
 * Es la decisio que **no toca res mes**: ni una regla, ni la memoria d'un
 * comerç, ni el model local la tornaran a canviar. Aixo es tot el que vol dir
 * `category_source = "user"`, i per aixo els quatre camps que ho deixen dit
 * van junts en un sol lloc: estaven escrits a ma quatre vegades dins del
 * mateix fitxer de rutes, i canviar la politica volia dir trobar-les totes.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { llmSuggestions, merchants, transactions } from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { rememberMerchantChoice } from "./merchants.ts";

/** El que vol dir «ho ha decidit una persona». */
export const HUMAN_DECISION = {
  categorySource: "user",
  categoryConfidence: 1,
  needsReview: false,
} as const;

export interface CategorizeOptions {
  /** Recorda-ho per a tot el comerç d'aquest espai. */
  rememberMerchant?: boolean;
}

export interface CategorizeResult {
  /** Quants moviments del mateix comerç han heretat la decisio. */
  recordats: number;
}

/**
 * Posa la categoria a un moviment, amb el que se'n derivi.
 *
 * Tot va dins d'una transaccio: si la memoria del comerç s'escriu i el
 * moviment no —o al reves— l'espai queda dient dues coses diferents.
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
 * El mateix, per a uns quants moviments alhora.
 *
 * **Tot o res**: si algun identificador no es de l'espai, no se n'aplica cap.
 * Una peticio a mitges deixaria qui la fa sense saber que ha canviat.
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
 * Confirmar un moviment des de la safata de revisio.
 *
 * Es el mateix que canviar-li la categoria, i a mes **tanca la proposta del
 * model** dient si l'encertava: es l'unica manera de saber si val la pena.
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

/** Diu si la proposta del model per a aquest comerç era bona. */
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
