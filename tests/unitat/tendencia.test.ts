/**
 * Recta de minims quadrats de la previsio: sense base de dades.
 */

import { describe, expect, test } from "bun:test";

import { money } from "../../src/lib/money.ts";
import { leastSquaresLine } from "../../src/services/forecast.ts";

describe("rectaMinimsQuadrats", () => {
  test("una serie lineal pura recupera els extrems", () => {
    // 1000, 990, …, 700: baixa 10 per dia durant 30 passos (31 punts).
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

  test("una serie plana es queda plana", () => {
    const values = Array.from({ length: 10 }, () => money(500));
    const line = leastSquaresLine(values);
    for (const v of line) expect(Number(v)).toBeCloseTo(500, 2);
  });

  test("amb dents de serra, la recta suavitza pero conserva el sentit", () => {
    // Baixa en global, amb un salt amunt al mig.
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
