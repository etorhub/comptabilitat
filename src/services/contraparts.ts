/**
 * Resol la contrapart d'un moviment com a comerç (payee).
 *
 * Es l'unica porta que escriu `transactions.merchant_id`. Serveix per a la
 * memoria de categoria en importar; no es un recurs de la interficie.
 */

import { db, type Transactor } from "../db/client.ts";
import { obteOCreaComerc } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";

export interface DadesContrapart {
  description: string;
  counterparty: string;
  bookingDate: string | null;
}

export interface Contrapart {
  merchantId: number | null;
  /** El que s'ha d'escriure a `transactions.normalized_description`. */
  normalizedKey: string;
  displayName: string;
}

const CONTRAPART_BUIDA: Contrapart = {
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
export async function resolContrapart(
  ledgerId: number,
  dades: DadesContrapart,
  connexio: Transactor = db,
  incrementaComptador = true,
): Promise<Contrapart> {
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
    normalizedKey: normalitzat,
    displayName: mostrar,
  };
}
