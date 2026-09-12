/**
 * Money.
 *
 * The Python version used `Decimal` everywhere. JavaScript has no equivalent,
 * and `numeric(14,2)` arrives from Drizzle as a **`string`**. Hence the rule:
 *
 *   - at the database edge, `string`;
 *   - in the services, `Decimal`;
 *   - at the template edge, an already-formatted `string`.
 *
 * `number` is only good enough for charts, which are only there to be looked
 * at. Running `parseFloat` on an amount in order to add it up is a correctness
 * bug in an accounting application, not a matter of style.
 */

import Decimal from "decimal.js";

// Two decimals, half-up rounding: what Python's `Decimal` does with
// `ROUND_HALF_UP`, which is what any bank expects.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** A monetary amount as it comes out of the database. */
export type MoneyString = string;

export const ZERO = new Decimal(0);

/** From the database (or an already-validated form) to `Decimal`. */
export function money(value: MoneyString | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Decimal(value);
}

/** From `Decimal` to the two-decimal string the database expects. */
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
 * For charts only. Any other use is a bug: if you find this in a calculation,
 * the calculation is wrong.
 */
export function toChartNumber(value: MoneyString | Decimal): number {
  return money(value).toNumber();
}

// --- Formatting ------------------------------------------------------------

// Catalan and euros, because this is shown on screen.
const currencyFormatter = new Intl.NumberFormat("ca-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** «1.234,56 €» */
export function formatMoney(value: MoneyString | Decimal | null | undefined): string {
  return currencyFormatter.format(money(value).toNumber());
}
