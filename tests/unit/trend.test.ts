/**
 * Least-squares line of the forecast: no database.
 */

import { describe, expect, test } from "bun:test";

import { money } from "../../src/lib/money.ts";
import { leastSquaresLine } from "../../src/services/forecast.ts";

describe("leastSquaresLine", () => {
  test("a pure linear series recovers the ends", () => {
    // 1000, 990, …, 700: down 10 a day for 30 steps (31 points).
    const values = Array.from({ length: 31 }, (_, i) => money(1000).minus(money(10).times(i)));
    const line = leastSquaresLine(values);

    expect(line).toHaveLength(31);
    expect(Number(line[0])).toBeCloseTo(1000, 1);
    expect(Number(line[30])).toBeCloseTo(700, 1);
    const first = line[0];
    const last = line[30];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(last?.lt(first ?? money(0))).toBe(true);
  });

  test("a flat series stays flat", () => {
    const values = Array.from({ length: 10 }, () => money(500));
    const line = leastSquaresLine(values);
    for (const v of line) expect(Number(v)).toBeCloseTo(500, 2);
  });

  test("with a sawtooth, the line smooths but keeps the direction", () => {
    // Down overall, with a jump up in the middle.
    const values = [
      money(1000),
      money(950),
      money(900),
      money(1200), // salt
      money(850),
      money(800),
      money(750),
    ];
    const line = leastSquaresLine(values);
    const first = line[0];
    const last = line.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(last?.lt(first ?? money(0))).toBe(true);
  });
});
