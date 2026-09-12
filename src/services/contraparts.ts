/**
 * Resol la contrapart d'un moviment com a comerç (payee).
 *
 * Es l'unica porta que escriu `transactions.merchant_id`. Serveix per a la
 * memoria de categoria en importar; no es un recurs de la interficie.
 */

import { db, type Transactor } from "../db/client.ts";
import { getOrCreateMerchant } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";

export interface CounterpartyData {
  description: string;
  counterparty: string;
  bookingDate: string | null;
}

export interface Counterparty {
  merchantId: number | null;
  /** El que s'ha d'escriure a `transactions.normalized_description`. */
  normalizedKey: string;
  displayName: string;
}

const COUNTERPARTY_EMPTY: Counterparty = {
  merchantId: null,
  normalizedKey: "",
  displayName: "",
};

/**
 * Obté (o crea) el comerç de la contrapart.
 *
 * @param incrementaComptador es passa tal qual a `obteOCreaComerc`: fals per
 *   a reassignacions en lot que després recompten.
 */
export async function resolveCounterparty(
  ledgerId: number,
  data: CounterpartyData,
  connection: Transactor = db,
  incrementaComptador = true,
): Promise<Counterparty> {
  const [normalitzat, mostrar] = normalizeDescription(data.description, data.counterparty);
  if (!normalitzat) return COUNTERPARTY_EMPTY;

  const merchant = await getOrCreateMerchant(
    ledgerId,
    normalitzat,
    mostrar,
    data.bookingDate,
    connection,
    incrementaComptador,
  );
  return {
    merchantId: merchant?.id ?? null,
    normalizedKey: normalitzat,
    displayName: mostrar,
  };
}
