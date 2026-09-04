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
import { construeixReglaApresa } from "./classification.ts";
import { recordaEleccioComerc } from "./merchants.ts";

/** El que vol dir «ho ha decidit una persona». */
export const DECISIO_HUMANA = {
  categorySource: "user",
  categoryConfidence: 1,
  needsReview: false,
} as const;

export interface OpcionsCategoritzar {
  /** Recorda-ho per a tot el comerç d'aquest espai. */
  recordaComerc?: boolean;
  /** I, a mes, crea'n una regla apresa. */
  creaRegla?: boolean;
  /** Qui ho ha decidit, per a la regla. */
  usuariId?: number;
}

export interface ResultatCategoritzar {
  /** Quants moviments del mateix comerç han heretat la decisio. */
  recordats: number;
}

/**
 * Posa la categoria a un moviment, amb el que se'n derivi.
 *
 * Tot va dins d'una transaccio: si la memoria del comerç s'escriu i el
 * moviment no —o al reves— l'espai queda dient dues coses diferents.
 */
export async function categoritzaMoviment(
  movimentId: number,
  fila: { merchantId: number | null; normalizedDescription: string; counterparty: string },
  ledgerId: number,
  categoryId: number | null,
  opcions: OpcionsCategoritzar = {},
): Promise<ResultatCategoritzar> {
  return db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId, ...DECISIO_HUMANA })
      .where(eq(transactions.id, movimentId));

    let recordats = 0;
    if (opcions.recordaComerc === true && fila.merchantId !== null) {
      recordats = await recordaComercDeLaFila(tx, fila.merchantId, categoryId);
    }

    if (opcions.creaRegla === true && opcions.usuariId !== undefined) {
      await construeixReglaApresa(
        {
          ledgerId,
          normalizedDescription: fila.normalizedDescription,
          counterparty: fila.counterparty,
        },
        categoryId,
        opcions.usuariId,
      );
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
export async function categoritzaEnBloc(
  movimentIds: number[],
  ledgerId: number,
  categoryId: number | null,
  opcions: { recordaComerc?: boolean } = {},
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
      .set({ categoryId, ...DECISIO_HUMANA })
      .where(
        inArray(
          transactions.id,
          meus.map((m) => m.id),
        ),
      );

    if (opcions.recordaComerc === true) {
      const comercIds = [
        ...new Set(meus.map((m) => m.merchantId).filter((x): x is number => x !== null)),
      ];
      for (const comercId of comercIds) {
        await recordaComercDeLaFila(tx, comercId, categoryId);
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
export async function confirmaDeLaRevisio(
  movimentId: number,
  fila: { merchantId: number | null; normalizedDescription: string; counterparty: string },
  ledgerId: number,
  categoryId: number,
  opcions: OpcionsCategoritzar = {},
): Promise<ResultatCategoritzar> {
  const resultat = await categoritzaMoviment(movimentId, fila, ledgerId, categoryId, opcions);
  await tancaLaPropostaDelModel(fila.merchantId, categoryId);
  return resultat;
}

/** Diu si la proposta del model per a aquest comerç era bona. */
async function tancaLaPropostaDelModel(
  merchantId: number | null,
  categoryId: number,
): Promise<void> {
  if (merchantId === null) return;

  const [proposta] = await db
    .select()
    .from(llmSuggestions)
    .where(and(eq(llmSuggestions.merchantId, merchantId), isNull(llmSuggestions.accepted)))
    .limit(1);
  if (!proposta) return;

  await db
    .update(llmSuggestions)
    .set({
      accepted: proposta.suggestedCategoryId === categoryId,
      reviewedAt: new Date(),
    })
    .where(eq(llmSuggestions.id, proposta.id));
}

async function recordaComercDeLaFila(
  tx: Transactor,
  merchantId: number,
  categoryId: number | null,
): Promise<number> {
  const [comerc] = await tx
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!comerc) return 0;
  return recordaEleccioComerc(comerc, categoryId, true, tx);
}
