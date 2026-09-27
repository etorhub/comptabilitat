/**
 * The pure pieces behind the written reports: the calendar and the checks
 * that decide what is "unexpected". No database.
 */

import { describe, expect, test } from "bun:test";

import { Decimal } from "../../src/lib/money.ts";
import {
  isDearer,
  isSpike,
  lastDayOf,
  sameDayLastMonth,
  shiftMonth,
  usualMonth,
} from "../../src/services/report-facts.ts";

const d = (v: string) => new Decimal(v);

describe("the calendar", () => {
  test("months move across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", -6)).toBe("2026-03");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
  });

  test("the last day of a month knows about February", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });

  test("the same day last month is clamped to that month's end", () => {
    expect(sameDayLastMonth("2026-09-27")).toBe("2026-08-27");
    expect(sameDayLastMonth("2026-03-31")).toBe("2026-02-28");
    expect(sameDayLastMonth("2026-01-15")).toBe("2025-12-15");
  });
});

describe("a category that shot up", () => {
  test("there is no usual month without enough history", () => {
    expect(usualMonth([])).toBeNull();
    expect(usualMonth([d("100")])).toBeNull();
  });

  test("the usual month is the average, zeros included", () => {
    expect(usualMonth([d("100"), d("0"), d("50")])?.toFixed(2)).toBe("50.00");
  });

  test("it needs both the ratio and the difference", () => {
    // 1.5× and +50 €: yes.
    expect(isSpike(d("150"), d("100"))).toBe(true);
    // Triple, but only +20 €: a small category, nothing to say.
    expect(isSpike(d("30"), d("10"))).toBe(false);
    // +60 € but only 1.1×: a big category moving a little.
    expect(isSpike(d("660"), d("600"))).toBe(false);
  });

  test("a category never used before counts once it is big enough", () => {
    expect(isSpike(d("49.99"), d("0"))).toBe(false);
    expect(isSpike(d("50"), d("0"))).toBe(true);
  });
});

describe("a bill dearer than expected", () => {
  test("only beyond the series' tolerance, whatever the sign", () => {
    expect(isDearer(d("-66.00"), d("-60.00"), d("6.00"))).toBe(false);
    expect(isDearer(d("-66.01"), d("-60.00"), d("6.00"))).toBe(true);
    // Cheaper is not unexpected spending.
    expect(isDearer(d("-40.00"), d("-60.00"), d("6.00"))).toBe(false);
  });
});
