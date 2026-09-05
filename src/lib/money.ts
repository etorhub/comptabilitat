/**
 * Diners.
 *
 * El Python feia servir `Decimal` a tot arreu. JavaScript no en te equivalent
 * i `numeric(14,2)` arriba de Drizzle com a **`string`**. La regla, doncs:
 *
 *   - a la vora de la base de dades, `string`;
 *   - als serveis, `Decimal`;
 *   - a la vora de la plantilla, `string` ja formatat.
 *
 * `number` nomes s'hi val per als grafics, que son nomes per mirar. Fer
 * `parseFloat` d'un import per sumar-lo es un error de correccio en una
 * aplicacio de comptabilitat, no una preferencia d'estil.
 */

import Decimal from "decimal.js";

// 2 decimals, arrodoniment a la meitat amunt: el que fa `Decimal` de Python
// amb `ROUND_HALF_UP`, que es el que espera qualsevol banc.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Import monetari tal com surt de la base de dades. */
export type MoneyString = string;

export const ZERO = new Decimal(0);

/** De la base de dades (o d'un formulari ja validat) a `Decimal`. */
export function money(value: MoneyString | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Decimal(value);
}

/** De `Decimal` a la cadena de dos decimals que espera la base de dades. */
export function toMoneyString(value: Decimal | number | string): MoneyString {
  return new Decimal(value).toFixed(2);
}

export function add(...values: (MoneyString | Decimal)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), ZERO);
}

export function sum(values: Iterable<MoneyString | Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(money(v));
  return total;
}

export function isNegative(value: MoneyString | Decimal): boolean {
  return money(value).isNegative();
}

export function abs(value: MoneyString | Decimal): Decimal {
  return money(value).abs();
}

/**
 * Nomes per als grafics. Qualsevol altre us es un error: si t'ho trobes en un
 * calcul, el calcul esta malament.
 */
export function toChartNumber(value: MoneyString | Decimal): number {
  return money(value).toNumber();
}

// --- Format ----------------------------------------------------------------

const formatadorLlarg = new Intl.NumberFormat("ca-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** «1.234,56 €» */
export function formatMoney(value: MoneyString | Decimal | null | undefined): string {
  return formatadorLlarg.format(money(value).toNumber());
}
