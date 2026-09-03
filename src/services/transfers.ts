/**
 * Aparellament de traspassos entre comptes propis.
 *
 * Moure diners entre dos comptes **del mateix espai** no es ni ingres ni
 * despesa: nomes canvia de lloc. Quan una sortida i una entrada iguals
 * s'aparellen, queden fora dels informes.
 *
 * El que arriba **d'un altre espai**, en canvi, si que compta: per a qui mira
 * Calella, uns diners que hi entren son una entrada de debò, i d'on venen no
 * es cosa seva. Per aixo tot aixo passa dins d'un sol espai.
 *
 * Traduccio de `backend/app/services/transfers.py`.
 */

import { and, asc, eq, gte, isNull } from "drizzle-orm";

import { db } from "../db/client.ts";
import { transactions } from "../db/schema/index.ts";
import { money } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { categoriaTraspas } from "./classification.ts";

/** Marge de dies entre la sortida d'un compte i l'entrada a l'altre. */
const MATCH_WINDOW_DAYS = 3;

interface Candidat {
  id: number;
  accountId: number;
  bookingDate: string;
  amount: string;
  categorySource: string;
}

/** Aparella sortides i entrades equivalents entre comptes del mateix espai. */
export async function detectaTraspassos(ledgerId: number, lookbackDays = 120): Promise<number> {
  const des = addDays(todayLocal(), -lookbackDays);

  const candidats = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      bookingDate: transactions.bookingDate,
      amount: transactions.amount,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        gte(transactions.bookingDate, des),
        isNull(transactions.transferGroupId),
        eq(transactions.status, "booked"),
      ),
    )
    .orderBy(asc(transactions.bookingDate), asc(transactions.id));

  const sortides = candidats.filter((c) => money(c.amount).isNegative());
  const entrades = candidats.filter((c) => money(c.amount).isPositive());
  if (sortides.length === 0 || entrades.length === 0) return 0;

  const categoria = await categoriaTraspas(ledgerId);
  const gastades = new Set<number>();
  let parelles = 0;

  for (const sortida of sortides) {
    if (gastades.has(sortida.id)) continue;

    const contrapart = trobaContrapart(sortida, entrades, gastades);
    if (contrapart === null) continue;

    const grup = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    for (const item of [sortida, contrapart]) {
      const canvis: Record<string, unknown> = { transferGroupId: grup };

      // La categoria d'un traspas no la tria ningu cada vegada, pero si una
      // persona n'hi ha posat una, es respecta.
      if (categoria !== null && item.categorySource !== "user") {
        canvis.categoryId = categoria.id;
        canvis.categorySource = "rule";
        canvis.categoryConfidence = 1;
        canvis.needsReview = false;
      }

      await db.update(transactions).set(canvis).where(eq(transactions.id, item.id));
    }

    gastades.add(sortida.id);
    gastades.add(contrapart.id);
    parelles += 1;
  }

  if (parelles > 0) {
    console.info(`[traspassos] ${parelles} aparellats dins de l'espai ${ledgerId}`);
  }
  return parelles;
}

/**
 * L'entrada que fa parella amb una sortida.
 *
 * Ha de ser d'un **altre compte**, del mateix import canviat de signe i dins
 * de la finestra; si n'hi ha mes d'una, guanya la mes propera en el temps.
 */
function trobaContrapart(
  sortida: Candidat,
  entrades: Candidat[],
  gastades: Set<number>,
): Candidat | null {
  const objectiu = money(sortida.amount).negated();
  let millor: Candidat | null = null;
  let millorDistancia = MATCH_WINDOW_DAYS + 1;

  for (const entrada of entrades) {
    if (gastades.has(entrada.id) || entrada.id === sortida.id) continue;
    // Del mateix compte no es un traspas.
    if (entrada.accountId === sortida.accountId) continue;
    if (!money(entrada.amount).equals(objectiu)) continue;

    const distancia = Math.abs(daysBetween(sortida.bookingDate, entrada.bookingDate));
    if (distancia > MATCH_WINDOW_DAYS) continue;

    if (distancia < millorDistancia) {
      millor = entrada;
      millorDistancia = distancia;
    }
  }

  return millor;
}
