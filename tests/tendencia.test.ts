/**
 * Recta de minims quadrats de la previsio: sense base de dades.
 */

import { describe, expect, test } from "bun:test";

import { money } from "../src/lib/money.ts";
import { rectaMinimsQuadrats } from "../src/services/forecast.ts";

describe("rectaMinimsQuadrats", () => {
  test("una serie lineal pura recupera els extrems", () => {
    // 1000, 990, …, 700: baixa 10 per dia durant 30 passos (31 punts).
    const valors = Array.from({ length: 31 }, (_, i) => money(1000).minus(money(10).times(i)));
    const recta = rectaMinimsQuadrats(valors);

    expect(recta).toHaveLength(31);
    expect(Number(recta[0])).toBeCloseTo(1000, 1);
    expect(Number(recta[30])).toBeCloseTo(700, 1);
    expect(recta[30]!.lt(recta[0]!)).toBe(true);
  });

  test("una serie plana es queda plana", () => {
    const valors = Array.from({ length: 10 }, () => money(500));
    const recta = rectaMinimsQuadrats(valors);
    for (const v of recta) expect(Number(v)).toBeCloseTo(500, 2);
  });

  test("amb dents de serra, la recta suavitza pero conserva el sentit", () => {
    // Baixa en global, amb un salt amunt al mig.
    const valors = [
      money(1000),
      money(950),
      money(900),
      money(1200), // salt
      money(850),
      money(800),
      money(750),
    ];
    const recta = rectaMinimsQuadrats(valors);
    expect(recta[recta.length - 1]!.lt(recta[0]!)).toBe(true);
  });
});
