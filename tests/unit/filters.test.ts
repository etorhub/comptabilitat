/**
 * The filter schemas read the names the forms send.
 *
 * `8688f24` renamed identifiers to English and took a few wire keys with them:
 * the forms kept sending `fins` and `mesos`, the schemas read `to` and
 * `months`, and «Fins a» and «Mesos» were ignored without a word. Each case
 * here goes through the query the page itself writes.
 */

import { describe, expect, test } from "bun:test";

import {
  reportFiltersSchema,
  reportFiltersToQuery,
  reportRange,
} from "../../src/routes/analytics/analytics.schema.ts";
import {
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "../../src/routes/transactions/transactions.schema.ts";

const fromQuery = (q: string) => Object.fromEntries(new URLSearchParams(q.replace(/^\?/, "")));

describe("the report filters", () => {
  test("read des, fins and mesos", () => {
    const f = reportFiltersSchema.parse({ des: "2026-07-01", fins: "2026-07-31", mesos: "24" });
    expect(f).toEqual({ des: "2026-07-01", to: "2026-07-31", months: 24 });
  });

  test("what the page writes is what it reads back", () => {
    const f = reportFiltersSchema.parse({ des: "2026-01-01", fins: "2026-06-30", mesos: "6" });
    const query = reportFiltersToQuery(f);
    expect(query).toBe("?des=2026-01-01&fins=2026-06-30&mesos=6");
    expect(reportFiltersSchema.parse(fromQuery(query))).toEqual(f);
  });

  test("the range is the filters, or the last months up to today", () => {
    const empty = reportFiltersSchema.parse({});
    expect(reportRange(empty, "2026-09-27")).toEqual(["2025-09-20", "2026-09-27"]);
    const six = reportFiltersSchema.parse({ mesos: "6" });
    expect(reportRange(six, "2026-09-27")[0]).toBe("2026-03-25");
    const fixed = reportFiltersSchema.parse({ des: "2026-07-01", fins: "2026-07-31" });
    expect(reportRange(fixed, "2026-09-27")).toEqual(["2026-07-01", "2026-07-31"]);
  });
});

describe("the transaction filters", () => {
  test("read fins", () => {
    expect(transactionFiltersSchema.parse({ fins: "2026-07-31" }).to).toBe("2026-07-31");
  });

  test("what the page writes is what it reads back", () => {
    const f = transactionFiltersSchema.parse({
      cerca: "glovo",
      des: "2026-07-01",
      fins: "2026-07-31",
      categoria: "3",
      traspassos: "1",
    });
    expect(transactionFiltersSchema.parse(fromQuery(transactionFiltersToQuery(f)))).toEqual(f);
  });
});
