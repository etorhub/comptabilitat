/**
 * Motor de regles de classificacio.
 *
 * Una regla te una llista de condicions que s'avaluen **totes en AND**. Les
 * regles s'apliquen per prioritat (la mes baixa, abans) i **la primera que
 * encaixa guanya**.
 *
 * Traduccio de `backend/app/services/rules.py`. Una condicio mal formada no
 * peta: es registra i es considera que no encaixa. Aixo importa perque les
 * condicions son JSON lliure a la base de dades i una regla trencada no ha de
 * poder aturar la classificacio de tota la resta.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  rules,
  ruleFieldSchema,
  ruleOperatorSchema,
  type Rule,
  type RuleField,
  type RuleOperator,
} from "../db/schema/index.ts";
import { Decimal } from "../lib/money.ts";

/** El que una regla mira d'un moviment. */
export interface MovimentAvaluable {
  ledgerId: number | null;
  description: string;
  normalizedDescription: string;
  counterparty: string;
  amount: string;
  bankTransactionCode: string;
  accountId: number;
}

export interface Condicio {
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

/** Treu els accents, com el `strip_accents` del Python. */
export function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

/** Text comparable: sense accents, en majuscules i sense espais als extrems. */
function comparable(value: unknown): string {
  return stripAccents(String(value ?? ""))
    .toUpperCase()
    .trim();
}

function valorDelCamp(moviment: MovimentAvaluable, field: RuleField): unknown {
  switch (field) {
    case "description":
      return moviment.description;
    case "normalized_description":
      return moviment.normalizedDescription;
    case "counterparty":
      return moviment.counterparty;
    case "amount":
      return moviment.amount;
    case "bank_transaction_code":
      return moviment.bankTransactionCode;
    case "account_id":
      return moviment.accountId;
  }
}

/** Llegeix una condicio del JSON. Retorna `null` si no te bona pinta. */
export function parseCondicio(cru: unknown): Condicio | null {
  if (typeof cru !== "object" || cru === null) return null;
  const obj = cru as Record<string, unknown>;

  const field = ruleFieldSchema.safeParse(obj.field);
  const operator = ruleOperatorSchema.safeParse(obj.operator);
  if (!field.success || !operator.success) {
    console.warn("[regles] condicio no valida:", cru);
    return null;
  }

  return {
    field: field.data,
    operator: operator.data,
    value: String(obj.value ?? ""),
  };
}

/** Les condicions d'una regla, ja llegides del JSON. */
export function condicionsDe(rule: Pick<Rule, "conditions">): Condicio[] {
  if (!Array.isArray(rule.conditions)) return [];
  return rule.conditions.map(parseCondicio).filter((c): c is Condicio => c !== null);
}

export function condicioEncaixa(condicio: Condicio, moviment: MovimentAvaluable): boolean {
  const actual = valorDelCamp(moviment, condicio.field);

  if (condicio.operator === "gt" || condicio.operator === "lt") {
    try {
      const llindar = new Decimal(String(condicio.value));
      const valor = new Decimal(String(actual));
      return condicio.operator === "gt" ? valor.gt(llindar) : valor.lt(llindar);
    } catch {
      return false;
    }
  }

  const esperat = comparable(condicio.value);
  const text = comparable(actual);

  switch (condicio.operator) {
    case "contains":
      return text.includes(esperat);
    case "equals":
      return text === esperat;
    case "starts_with":
      return text.startsWith(esperat);
    case "regex":
      try {
        return new RegExp(String(condicio.value), "i").test(text);
      } catch {
        console.warn("[regles] expressio regular no valida:", condicio.value);
        return false;
      }
  }
}

export function reglaEncaixa(rule: Rule, moviment: MovimentAvaluable): boolean {
  if (!rule.isActive) return false;
  // Una regla nomes val dins del seu espai. Es una segona barrera: encara que
  // algu passes una regla d'un altre espai, aqui no encaixaria.
  if (rule.ledgerId !== moviment.ledgerId) return false;

  const condicions = condicionsDe(rule);
  if (condicions.length === 0) return false;

  return condicions.every((c) => condicioEncaixa(c, moviment));
}

/** Regles actives d'un espai, per prioritat. */
export async function reglesActives(ledgerId: number): Promise<Rule[]> {
  return db
    .select()
    .from(rules)
    .where(and(eq(rules.isActive, true), eq(rules.ledgerId, ledgerId)))
    .orderBy(asc(rules.priority), asc(rules.id));
}

/** La primera regla que encaixa. La primera guanya i les altres no es miren. */
export function primeraQueEncaixa(
  regles: Rule[],
  moviment: MovimentAvaluable,
): Rule | null {
  return regles.find((regla) => reglaEncaixa(regla, moviment)) ?? null;
}

/** Text llegible d'una condicio, per ensenyar-la a la taula de regles. */
const NOMS_CAMP: Record<RuleField, string> = {
  description: "el concepte",
  normalized_description: "el concepte normalitzat",
  counterparty: "la contrapart",
  amount: "l'import",
  bank_transaction_code: "el codi del banc",
  account_id: "el compte",
};

const NOMS_OPERADOR: Record<RuleOperator, string> = {
  contains: "conté",
  equals: "és igual a",
  starts_with: "comença per",
  regex: "encaixa amb",
  gt: "és més gran que",
  lt: "és més petit que",
};

/**
 * «el concepte conté "MERCADONA"».
 *
 * La taula de regles de l'aplicacio de React ensenyava els noms en angles,
 * tal com surten de la base de dades.
 */
export function condicioLlegible(condicio: Condicio): string {
  return `${NOMS_CAMP[condicio.field]} ${NOMS_OPERADOR[condicio.operator]} «${condicio.value}»`;
}

export { NOMS_CAMP, NOMS_OPERADOR };
