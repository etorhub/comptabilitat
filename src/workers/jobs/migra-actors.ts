/**
 * Migracio d'un sol us: reparteix els comerços que en realitat son titulars
 * de transferencia cap a `actors`.
 *
 * Abans d'aquest canvi (`0002_actors_i_recurrents`) no hi havia distincio: una
 * `TRANSFERENCIA DE JOAN GARCIA` acabava com a comerç `JOAN GARCIA`. Aquesta
 * feina recorre els comerços que ja hi ha i, dels que **nomes** tenen
 * moviments de transferencia, en fa actors.
 *
 * Un comerç amb moviments barrejats (alguna transferencia i alguna compra)
 * **no es toca**: es queda com a comerç, i la passada nocturna de
 * `reassignaNormalitzacio` ja el reparteix moviment a moviment.
 *
 * Es executable a ma amb `bun run jobs migra-actors [--espai 1]` i no cal que
 * torni a corre un cop feta.
 */

import { asc, eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { merchants, transactions } from "../../db/schema/index.ts";
import { obteOCreaActor, recompteActors } from "../../services/actors.ts";
import { detectaTipusOperacio, normalizeActorName } from "../../services/normalization.ts";

export interface ResultatMigracioActors {
  comercosRevisats: number;
  comercosConvertits: number;
  movimentsRepuntats: number;
}

export async function migraActors(ledgerId?: number): Promise<ResultatMigracioActors> {
  const resultat: ResultatMigracioActors = {
    comercosRevisats: 0,
    comercosConvertits: 0,
    movimentsRepuntats: 0,
  };

  const comercos = await db
    .select({ id: merchants.id, ledgerId: merchants.ledgerId })
    .from(merchants)
    .where(ledgerId === undefined ? undefined : eq(merchants.ledgerId, ledgerId));

  for (const comerc of comercos) {
    resultat.comercosRevisats += 1;

    const moviments = await db
      .select({
        id: transactions.id,
        description: transactions.description,
        counterparty: transactions.counterparty,
        bookingDate: transactions.bookingDate,
      })
      .from(transactions)
      .where(eq(transactions.merchantId, comerc.id))
      .orderBy(asc(transactions.bookingDate));

    if (moviments.length === 0) continue;

    const totsTransferencia = moviments.every(
      (m) => detectaTipusOperacio(m.description) === "transferencia",
    );
    if (!totsTransferencia) continue;

    const actorsTocats = new Set<number>();

    await db.transaction(async (tx) => {
      for (const moviment of moviments) {
        const [normalitzat, mostrar] = normalizeActorName(
          moviment.description,
          moviment.counterparty,
        );
        if (!normalitzat) continue;

        const actor = await obteOCreaActor(
          comerc.ledgerId,
          normalitzat,
          mostrar,
          moviment.bookingDate,
          tx,
        );
        if (!actor) continue;
        actorsTocats.add(actor.id);

        await tx
          .update(transactions)
          .set({
            actorId: actor.id,
            merchantId: null,
            normalizedDescription: normalitzat.slice(0, 200),
          })
          .where(eq(transactions.id, moviment.id));

        resultat.movimentsRepuntats += 1;
      }

      // `llm_suggestions.merchant_id` cau en cascada; la categoria dels
      // moviments no es toca, nomes la `default_category_id` del comerç.
      await tx.delete(merchants).where(eq(merchants.id, comerc.id));
    });

    await recompteActors([...actorsTocats]);
    resultat.comercosConvertits += 1;
  }

  return resultat;
}
