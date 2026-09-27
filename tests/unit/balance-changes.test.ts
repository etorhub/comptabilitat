/**
 * The figures above the balance chart, and the month helpers they use: no
 * database.
 */

import { describe, expect, test } from "bun:test";

import { addMonths, formatMonth } from "../../src/lib/time.ts";
import { BalanceChanges } from "../../src/routes/analytics/analytics.fragment.ts";

describe("month helpers", () => {
  test("addMonths crosses years both ways", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-09", -12)).toBe("2025-09");
  });

  test("formatMonth is Catalan", () => {
    expect(formatMonth("2026-08")).toContain("agost");
    expect(formatMonth("2026-08")).toContain("2026");
  });
});

describe("BalanceChanges", () => {
  test("signs and colours the change of the month and the average", () => {
    const text = String(
      BalanceChanges({
        lastMonth: { period: "2026-08", change: "-340.00" },
        average: { change: "120.50", months: 12 },
      }),
    );
    expect(text).toContain("agost");
    expect(text).toMatch(/xifra-valor negatiu">-340/);
    expect(text).toMatch(/xifra-valor positiu">\+120,50/);
    expect(text).toContain("últims 12 mesos");
  });

  test("says how many months the average is over when there are fewer than twelve", () => {
    const text = String(
      BalanceChanges({
        lastMonth: { period: "2026-08", change: "0.00" },
        average: { change: "10.00", months: 7 },
      }),
    );
    expect(text).toContain("mitjana de 7 mesos");
  });

  test("with no whole month, a dash and no figure", () => {
    const text = String(BalanceChanges({ lastMonth: null, average: null }));
    expect(text.match(/—/g)).toHaveLength(2);
  });
});
