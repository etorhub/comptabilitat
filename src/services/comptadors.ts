/**
 * Els comptadors de la barra lateral.
 *
 * Viuen en un servei propi perque son **objectius fora de banda**: qui els
 * canvia els ha de tornar a dibuixar, i qui els canvia no es sempre el mateix
 * recurs que els ensenya. Categoritzar un moviment mou el de «per revisar»;
 * descartar un avis mou el d'avisos.
 *
 * Aixo substitueix l'`invalidaEspai()` de l'aplicacio anterior, que despres de
 * qualsevol mutacio tornava a demanar la llista, el panell i els dos
 * comptadors. Ara es diu exactament que canvia.
 */

import { and, count, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { alerts, transactions } from "../db/schema/index.ts";

/** Moviments que esperen que algu els confirmi la categoria. */
export async function comptaPerRevisar(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.needsReview, true)));
  return row?.n ?? 0;
}

/** Avisos que ningu no ha mirat encara. */
export async function comptaAvisosNous(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(alerts)
    .where(and(eq(alerts.ledgerId, ledgerId), eq(alerts.status, "new")));
  return row?.n ?? 0;
}

export interface Comptadors {
  perRevisar: number;
  avisosNous: number;
}

/** Els dos alhora, per dibuixar una pagina sencera. */
export async function comptadors(ledgerId: number): Promise<Comptadors> {
  const [perRevisar, avisosNous] = await Promise.all([
    comptaPerRevisar(ledgerId),
    comptaAvisosNous(ledgerId),
  ]);
  return { perRevisar, avisosNous };
}
