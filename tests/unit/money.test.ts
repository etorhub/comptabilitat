/**
 * Form amounts: Zod 4 runs `.transform()` even after a failed `.regex()`, so
 * parsing has to return null instead of throwing into `safeParse`.
 */

import { describe, expect, test } from "bun:test";

import { parseFormAmount } from "../../src/lib/money.ts";
import { createSeriesSchema } from "../../src/routes/recurring/recurring.schema.ts";

describe("parseFormAmount", () => {
  test("accepts a plain number with a period or a comma", () => {
    expect(parseFormAmount("12.99")).toBe("12.99");
    expect(parseFormAmount("12,99")).toBe("12.99");
    expect(parseFormAmount(" 12,5 ")).toBe("12.50");
  });

  test("accepts an optional euro sign and spaces", () => {
    expect(parseFormAmount("534.25 €")).toBe("534.25");
    expect(parseFormAmount("534,25€")).toBe("534.25");
    expect(parseFormAmount("€12.00")).toBe("12.00");
  });

  test("rejects thousands separators and junk", () => {
    expect(parseFormAmount("1.234,56")).toBeNull();
    expect(parseFormAmount("abc")).toBeNull();
    expect(parseFormAmount("")).toBeNull();
    expect(parseFormAmount("-12.00")).toBeNull();
  });

  test("signed mode keeps the minus", () => {
    expect(parseFormAmount("-12,50", { signed: true })).toBe("-12.50");
    expect(parseFormAmount("12.50", { signed: true })).toBe("12.50");
  });
});

describe("createSeriesSchema amount", () => {
  const base = {
    label: "Llum",
    category_id: "1",
    cadence: "monthly",
    sentit: "out",
    next_expected_date: "2026-11-01",
  };

  test("a copied amount with € does not 500", () => {
    const parsed = createSeriesSchema.safeParse({ ...base, amount: "534.25 €" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amount).toBe("534.25");
  });

  test("an invalid amount is a 422-shaped error, not a throw", () => {
    const parsed = createSeriesSchema.safeParse({ ...base, amount: "no" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("L'import no es valid");
    }
  });
});
