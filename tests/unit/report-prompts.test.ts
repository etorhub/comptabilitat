/**
 * What the model is shown: figures already formatted, nothing else.
 */

import { expect, test } from "bun:test";

import { buildDailyPrompt, buildMonthlyPrompt } from "../../src/lib/ollama/report-prompts.ts";
import type { DailyFacts, MonthlyFacts, Unexpected } from "../../src/services/report-facts.ts";

const none: Unexpected = {
  outsideRecurring: [],
  categorySpikes: [],
  dearerBills: [],
  newMerchants: [],
};

test("the monthly prompt carries the figures as they will be shown", () => {
  const facts: MonthlyFacts = {
    kind: "monthly",
    month: "2026-08",
    from: "2026-08-01",
    to: "2026-08-31",
    totals: { income: "2500.00", expenses: "1834.20", result: "665.80" },
    fixedExpenses: "900.00",
    variableExpenses: "934.20",
    previous: { income: "2500.00", expenses: "1500.00", result: "1000.00" },
    topCategories: [{ category: "Supermercat", amount: "420.00", percent: 23 }],
    unexpected: {
      ...none,
      outsideRecurring: [
        { date: "2026-08-12", label: "Taller", category: "Cotxe", amount: "380.00" },
      ],
    },
  };

  const prompt = buildMonthlyPrompt("Personal", facts);
  expect(prompt).toContain("«Personal»");
  expect(prompt).toContain("1.834,20");
  expect(prompt).toContain("Supermercat");
  expect(prompt).toContain("Taller (Cotxe)");
  // An empty list is said to be empty, so the model does not fill it in.
  expect(prompt).toContain("Comerços nous on s'ha pagat per primera vegada: cap");
  // The model gets no raw amounts to do sums with.
  expect(prompt).not.toContain("1834.20");
});

test("the daily prompt says when the balance is unknown", () => {
  const facts: DailyFacts = {
    kind: "daily",
    day: "2026-09-27",
    month: "2026-09",
    totals: { income: "0.00", expenses: "120.00", result: "-120.00" },
    lastMonthToDate: { income: "0.00", expenses: "90.00", result: "-90.00" },
    balance: null,
    balanceDate: null,
    expected: [{ date: "2026-09-30", label: "Lloguer", amount: "-800.00" }],
    expectedTotal: "-800.00",
    projectedBalance: null,
    unexpected: none,
  };

  const prompt = buildDailyPrompt("Personal", facts);
  expect(prompt).toContain("Saldo actual: desconegut");
  expect(prompt).toContain("Saldo previst a final de mes: desconegut");
  expect(prompt).toContain("Lloguer");
  expect(prompt).toContain("-800,00");
});
