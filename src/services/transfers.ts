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

import { asc, eq } from "drizzle-orm";

import { countableTransactions } from "./filtres.ts";
import { db } from "../db/client.ts";
import { transactions } from "../db/schema/index.ts";
import { money } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { transferCategory } from "./classification.ts";

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
export async function detectTransfers(ledgerId: number, lookbackDays = 120): Promise<number> {
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
    // El mateix filtre que fan servir els informes. L'`is_excluded` d'aqui no
    // es un detall: aparellar un moviment exclos escriuria el grup **a l'altra
    // cama** i la trauria dels informes sense que ningu ho hagues demanat.
    .where(countableTransactions({ workspaces: ledgerId, des }))
    .orderBy(asc(transactions.bookingDate), asc(transactions.id));

  const sortides = candidats.filter((c) => money(c.amount).isNegative());
  const entrades = candidats.filter((c) => money(c.amount).isPositive());
  if (sortides.length === 0 || entrades.length === 0) return 0;

  const category = await transferCategory(ledgerId);
  const gastades = new Set<number>();
  let parelles = 0;

  for (const output of sortides) {
    if (gastades.has(output.id)) continue;

    const counterparty = findCounterparty(output, entrades, gastades);
    if (counterparty === null) continue;

    const group = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    // **Les dues cames, o cap.** Si nomes se n'etiqueta una, els informes
    // deixen fora la sortida i continuen comptant l'entrada: el mes surt
    // malament per l'import sencer i sembla correcte. I ja no es repara sol,
    // perque la cama orfe te `transfer_group_id` i aquesta consulta nomes mira
    // les que el tenen buit.
    await db.transaction(async (tx) => {
      for (const item of [output, counterparty]) {
        // Tipat amb la taula: aixi una errada al nom d'un camp no compila, en
        // lloc d'escriure's en silenci.
        const canvis: Partial<typeof transactions.$inferInsert> = { transferGroupId: group };

        // La categoria d'un traspas no la tria ningu cada vegada, pero si una
        // persona n'hi ha posat una, es respecta.
        if (category !== null && item.categorySource !== "user") {
          canvis.categoryId = category.id;
          canvis.categorySource = "rule";
          canvis.categoryConfidence = 1;
          canvis.needsReview = false;
        }

        await tx.update(transactions).set(canvis).where(eq(transactions.id, item.id));
      }
    });

    gastades.add(output.id);
    gastades.add(counterparty.id);
    parelles += 1;
  }

  if (parelles > 0) {
    console.info(`[traspassos] ${parelles} aparellats dins de l'espai ${ledgerId}`);
  }
  return parelles;
}

/**
 * The credit leg that pairs with a given debit leg.
 *
 * It has to be on a **different account**, for the same amount with the sign
 * flipped, and inside the window; if there is more than one, the closest in
 * time wins.
 */
function findCounterparty(
  debit: Candidat,
  credits: Candidat[],
  used: Set<number>,
): Candidat | null {
  const target = money(debit.amount).negated();
  let best: Candidat | null = null;
  let bestDistance = MATCH_WINDOW_DAYS + 1;

  for (const credit of credits) {
    if (used.has(credit.id) || credit.id === debit.id) continue;
    // Within the same account it is not a transfer.
    if (credit.accountId === debit.accountId) continue;
    if (!money(credit.amount).equals(target)) continue;

    const distance = Math.abs(daysBetween(debit.bookingDate, credit.bookingDate));
    if (distance > MATCH_WINDOW_DAYS) continue;

    if (distance < bestDistance) {
      best = credit;
      bestDistance = distance;
    }
  }

  return best;
}
