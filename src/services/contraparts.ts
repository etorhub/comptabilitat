/**
 * Reparteix la contrapart d'un moviment entre comerç i actor.
 *
 * Es l'unica porta que escriu `transactions.merchant_id` o
 * `transactions.actor_id`: **mai els dos alhora**. La decisio es pel tipus
 * d'operacio (`detectaTipusOperacio`, `services/normalization.ts`): nomes una
 * transferencia fa actor. Un Bizum, una nomina, un rebut o una compra amb
 * targeta continuen sent comerços, com sempre.
 */

import { db, type Transactor } from "../db/client.ts";
import { obteOCreaActor } from "./actors.ts";
import { obteOCreaComerc } from "./merchants.ts";
import {
  detectaTipusOperacio,
  normalizeActorName,
  normalizeDescription,
} from "./normalization.ts";

export interface DadesContrapart {
  description: string;
  counterparty: string;
  bookingDate: string | null;
}

export interface Contrapart {
  merchantId: number | null;
  actorId: number | null;
  /** El que s'ha d'escriure a `transactions.normalized_description`. */
  normalizedKey: string;
  displayName: string;
}

const CONTRAPART_BUIDA: Contrapart = {
  merchantId: null,
  actorId: null,
  normalizedKey: "",
  displayName: "",
};

/**
 * Decideix si la contrapart d'un moviment es un comerç o un actor, i l'obté
 * (creant-lo si cal).
 *
 * @param incrementaComptador es passa tal qual a `obteOCreaComerc` /
 *   `obteOCreaActor`: fals per a reassignacions en lot que després recompten.
 */
export async function resolContrapart(
  ledgerId: number,
  dades: DadesContrapart,
  connexio: Transactor = db,
  incrementaComptador = true,
): Promise<Contrapart> {
  const tipus = detectaTipusOperacio(dades.description);

  if (tipus === "transferencia") {
    const [normalitzat, mostrar] = normalizeActorName(dades.description, dades.counterparty);
    if (!normalitzat) return CONTRAPART_BUIDA;

    const actor = await obteOCreaActor(
      ledgerId,
      normalitzat,
      mostrar,
      dades.bookingDate,
      connexio,
      incrementaComptador,
    );
    return {
      merchantId: null,
      actorId: actor?.id ?? null,
      normalizedKey: normalitzat,
      displayName: mostrar,
    };
  }

  const [normalitzat, mostrar] = normalizeDescription(dades.description, dades.counterparty);
  if (!normalitzat) return CONTRAPART_BUIDA;

  const comerc = await obteOCreaComerc(
    ledgerId,
    normalitzat,
    mostrar,
    dades.bookingDate,
    connexio,
    incrementaComptador,
  );
  return {
    merchantId: comerc?.id ?? null,
    actorId: null,
    normalizedKey: normalitzat,
    displayName: mostrar,
  };
}
