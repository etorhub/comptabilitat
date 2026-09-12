/**
 * Que compta com a moviment de debo.
 *
 * Un moviment nomes suma als informes, a la previsio i a la deteccio de
 * recurrents si compleix **totes** aquestes condicions:
 *
 *   - es de l'espai que es mira;
 *   - esta consolidat (`booked`), no pendent;
 *   - no forma part d'un traspas entre comptes propis, que nomes canvia els
 *     diners de lloc;
 *   - i ningu no l'ha exclos a ma.
 *
 * **Aixo viu en un sol lloc a proposit.** N'hi havia cinc copies escrites a
 * ma i no deien totes el mateix: la dels traspassos es descuidava
 * `is_excluded`, i per aixo un moviment exclos podia entrar en una parella i
 * treure l'altra cama dels informes sense que ningu ho hagues demanat. Si
 * algun dia cal canviar que compta, es canvia aqui.
 */

import { and, eq, gte, inArray, isNull, lt, lte, type SQL } from "drizzle-orm";

import { transactions } from "../db/schema/index.ts";

export interface FilterOptions {
  /** Un espai o uns quants. */
  workspaces: number | number[];
  /** Des d'aquesta data, inclosa. */
  des?: string | null;
  /** Fins a aquesta data, inclosa. */
  fins?: string | null;
  /** Nomes els que treuen diners. */
  onlyExpenses?: boolean;
}

export function countableTransactions(options: FilterOptions): SQL | undefined {
  const workspaces = Array.isArray(options.workspaces)
    ? options.workspaces
    : [options.workspaces];

  const parts: (SQL | undefined)[] = [
    inArray(transactions.ledgerId, workspaces),
    eq(transactions.status, "booked"),
    isNull(transactions.transferGroupId),
    eq(transactions.isExcluded, false),
  ];

  if (options.des != null) parts.push(gte(transactions.bookingDate, options.des));
  if (options.fins != null) parts.push(lte(transactions.bookingDate, options.fins));
  if (options.onlyExpenses === true) parts.push(lt(transactions.amount, "0"));

  return and(...parts);
}
