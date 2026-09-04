/**
 * Aplicar una regla als moviments que ja hi ha.
 *
 * Es la part de `backend/app/services/classification.py` que fa falta per a
 * les regles. La resta del motor de classificacio arriba amb els moviments.
 */

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { rules, transactions, type Rule } from "../db/schema/index.ts";
import { reglaEncaixa, type MovimentAvaluable } from "./rules.ts";

/**
 * Aplica una regla als moviments ja importats del seu espai.
 *
 * **No toca els que ha classificat una persona**, com tota la resta del motor.
 * Retorna quants n'ha canviat i puja el comptador de la regla.
 */
export async function aplicaReglaAlsExistents(rule: Rule): Promise<number> {
  const candidats = await db
    .select({
      id: transactions.id,
      ledgerId: transactions.ledgerId,
      description: transactions.description,
      normalizedDescription: transactions.normalizedDescription,
      counterparty: transactions.counterparty,
      amount: transactions.amount,
      bankTransactionCode: transactions.bankTransactionCode,
      accountId: transactions.accountId,
      tags: transactions.tags,
    })
    .from(transactions)
    .where(
      and(eq(transactions.ledgerId, rule.ledgerId), ne(transactions.categorySource, "user")),
    );

  const encaixen = candidats.filter((t) => reglaEncaixa(rule, t as MovimentAvaluable));
  if (encaixen.length === 0) return 0;

  await db.transaction(async (tx) => {
    for (const moviment of encaixen) {
      const etiquetes =
        rule.setTags.length > 0
          ? [...new Set([...(moviment.tags ?? []), ...rule.setTags])].toSorted()
          : moviment.tags;

      await tx
        .update(transactions)
        .set({
          ...(rule.setCategoryId !== null ? { categoryId: rule.setCategoryId } : {}),
          tags: etiquetes,
          categorySource: "rule",
          categoryConfidence: 1,
          needsReview: false,
          appliedRuleId: rule.id,
        })
        .where(eq(transactions.id, moviment.id));
    }

    // Sumat a la base de dades: si mentrestant hi ha passat una
    // sincronitzacio, el valor que teniem llegit ja no valia.
    await tx
      .update(rules)
      .set({ matchCount: sql`${rules.matchCount} + ${encaixen.length}` })
      .where(eq(rules.id, rule.id));
  });

  return encaixen.length;
}

/** Quants moviments encaixarien amb una regla, sense tocar-ne cap. */
export async function comptaEncaixos(rule: Rule): Promise<number> {
  const candidats = await db
    .select({
      ledgerId: transactions.ledgerId,
      description: transactions.description,
      normalizedDescription: transactions.normalizedDescription,
      counterparty: transactions.counterparty,
      amount: transactions.amount,
      bankTransactionCode: transactions.bankTransactionCode,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(eq(transactions.ledgerId, rule.ledgerId));

  return candidats.filter((t) => reglaEncaixa(rule, t as MovimentAvaluable)).length;
}
