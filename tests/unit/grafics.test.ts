/**
 * Chart payload keys must match what `public/grafics.js` reads.
 *
 * When the TypeScript side was renamed to English, the client kept Catalan
 * keys (`ingressos`, `historic`, …). Charts drew empty series with no error.
 * This test pins both ends of that contract.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  BalanceChart,
  CategoryChart,
  ForecastChart,
  MerchantChart,
  MonthlyChart,
} from "../../src/routes/analytics/analytics.fragment.ts";
import type { Forecast } from "../../src/services/forecast.ts";

const graficsJs = readFileSync(join(import.meta.dir, "../../public/grafics.js"), "utf8");

function payloadOf(html: { toString(): string }): unknown {
  const text = String(html);
  const match = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(text);
  if (!match?.[1]) throw new Error("chart fragment has no JSON payload");
  return JSON.parse(match[1]);
}

describe("grafics contract", () => {
  test("monthly chart keys are the ones grafics.js reads", () => {
    const data = payloadOf(
      MonthlyChart([
        {
          periode: "2026-01",
          income: "100.00",
          expenses: "70.00",
          fixedExpenses: "40.00",
          variableExpenses: "30.00",
          cleaned: "30.00",
        },
      ]),
    ) as Record<string, number | string>[];

    expect(data[0]).toEqual({
      periode: "2026-01",
      income: 100,
      fixedExpenses: 40,
      variableExpenses: 30,
      cleaned: 30,
    });
    expect(graficsJs).toContain("d.income");
    expect(graficsJs).toContain("d.fixedExpenses");
    expect(graficsJs).toContain("d.variableExpenses");
    expect(graficsJs).toContain("d.cleaned");
    expect(graficsJs).not.toContain("d.ingressos");
    expect(graficsJs).not.toContain("d.despesesFixes");
  });

  test("balance and forecast chart keys are the ones grafics.js reads", () => {
    const balances = payloadOf(
      BalanceChart([{ day: "2026-01-01", balance: "12.50" }]),
    ) as Record<string, number | string>[];
    expect(balances[0]).toEqual({ day: "2026-01-01", balance: 12.5 });
    expect(graficsJs).toContain("d.day");
    expect(graficsJs).toContain("d.balance");
    expect(graficsJs).not.toContain("d.dia");
    expect(graficsJs).not.toContain("d.saldo");

    const forecast: Forecast = {
      ledgerId: 1,
      ledgerName: "Personal",
      currency: "EUR",
      openingBalance: "100.00",
      threshold: "0.00",
      horizonDays: 30,
      dailySpend: "0.00",
      firstOverdraft: null,
      firstOverdraftAmount: null,
      history: [{ day: "2026-01-01", balance: "100.00" }],
      points: [
        {
          day: "2026-01-02",
          expected: "90.00",
          optimista: "95.00",
          pessimistic: "85.00",
          trend: "88.00",
        },
      ],
      events: [],
    };
    const data = payloadOf(ForecastChart(forecast)) as Record<string, unknown>;
    expect(Object.keys(data).toSorted()).toEqual(
      ["billDays", "firstOverdraft", "history", "points", "threshold"].toSorted(),
    );
    expect(graficsJs).toContain("dades.history");
    expect(graficsJs).toContain("dades.points");
    expect(graficsJs).toContain("dades.threshold");
    expect(graficsJs).toContain("dades.firstOverdraft");
    expect(graficsJs).toContain("dades.billDays");
    expect(graficsJs).not.toContain("dades.historic");
    expect(graficsJs).not.toContain("dades.punts");
  });

  test("category and merchant charts already shared English keys", () => {
    const categories = payloadOf(
      CategoryChart([
        {
          categoryId: 1,
          categoryName: "Habitatge",
          color: "#0ea5e9",
          amount: "10.00",
          share: 1,
          transactions: 1,
        },
      ]),
    ) as Record<string, unknown>[];
    expect(categories[0]).toMatchObject({
      categoryName: "Habitatge",
      color: "#0ea5e9",
      amount: 10,
    });

    const merchants = payloadOf(
      MerchantChart([
        { merchantId: 1, merchantName: "Botiga", amount: "5.00", transactions: 1 },
      ]),
    ) as Record<string, unknown>[];
    expect(merchants[0]).toEqual({ merchantName: "Botiga", amount: 5 });
    expect(graficsJs).toContain("d.categoryName");
    expect(graficsJs).toContain("d.merchantName");
  });
});
