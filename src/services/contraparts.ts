/**
 * Resolves a transaction's counterparty as a merchant (payee).
 *
 * It is the only door that writes `transactions.merchant_id`. It serves the
 * category memory when importing; it is not an interface resource.
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
  /** What has to be written to `transactions.normalized_description`. */
  normalizedKey: string;
  displayName: string;
}

const COUNTERPARTY_EMPTY: Counterparty = {
  merchantId: null,
  normalizedKey: "",
  displayName: "",
};

/**
 * Gets (or creates) the counterparty's merchant.
 *
 * @param incrementaComptador passed straight to `getOrCreateMerchant`: false
 *   for batch reassignments that recount afterwards.
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
