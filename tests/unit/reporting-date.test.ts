/**
 * The late-salary reporting-date rule.
 *
 * A booking on day 28–31 of the salary category counts on the first of the
 * next month; everything else keeps the booking date.
 */

import { describe, expect, test } from "bun:test";

import {
  autoReportingDate,
  effectiveDate,
  SALARY_SHIFT_FROM_DAY,
} from "../../src/services/reporting-date.ts";
import { SLUG_SALARY } from "../../src/services/slugs.ts";

describe("autoReportingDate", () => {
  test("shifts late salary into the next month", () => {
    expect(autoReportingDate("2026-01-28", SLUG_SALARY)).toBe("2026-02-01");
    expect(autoReportingDate("2026-01-31", SLUG_SALARY)).toBe("2026-02-01");
    expect(autoReportingDate("2026-12-30", SLUG_SALARY)).toBe("2027-01-01");
  });

  test(`does not shift salary before day ${SALARY_SHIFT_FROM_DAY}`, () => {
    expect(autoReportingDate("2026-01-27", SLUG_SALARY)).toBeNull();
    expect(autoReportingDate("2026-02-01", SLUG_SALARY)).toBeNull();
  });

  test("ignores other categories", () => {
    expect(
      autoReportingDate("2026-01-28", "ingressos-del-treball-facturacio-i-autonoms"),
    ).toBeNull();
    expect(autoReportingDate("2026-01-28", null)).toBeNull();
  });
});

describe("effectiveDate", () => {
  test("falls back to the booking date", () => {
    expect(effectiveDate("2026-01-28", null)).toBe("2026-01-28");
    expect(effectiveDate("2026-01-28", "2026-02-01")).toBe("2026-02-01");
  });
});
