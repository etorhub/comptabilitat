/**
 * Reading Enable Banking's responses.
 *
 * The function that matters here is `dedupKey()`. **It has to give exactly
 * the same as the Python one**: there are already some stored in
 * `transactions.dedup_key`, and if it changed, the next synchronization would
 * recognize no transaction and would silently duplicate the whole history.
 *
 * The expectations in the data file are the recorded output of
 * `backend/app/integrations/enablebanking/parsing.py`.
 */

import { describe, expect, test } from "bun:test";

import { dedupKey, parseTransaction } from "../../src/lib/enablebanking/parsing.ts";
import cases from "../fixtures/enablebanking.json";

interface Case {
  raw: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

describe("behaves the same as the Python implementation", () => {
  test(`${(cases as Case[]).length} recorded responses give the same`, () => {
    for (const testCase of cases as Case[]) {
      const got = parseTransaction(testCase.raw);

      if (testCase.expected === null) {
        expect(got).toBeNull();
        continue;
      }

      expect(got).not.toBeNull();
      const { raw, ...rest } = got as NonNullable<typeof got>;
      void raw;
      expect({
        ...rest,
        dedupKey: dedupKey(got as NonNullable<typeof got>),
      }).toEqual(testCase.expected as never);
    }
  });
});

describe("the deduplication key", () => {
  const base = {
    entryReference: null,
    transactionId: null,
    bookingDate: "2026-03-01",
    valueDate: null,
    amount: "-45.20",
    currency: "EUR",
    status: "booked" as const,
    description: "COMPRA MERCADONA",
    counterparty: "Mercadona",
    bankTransactionCode: "",
    raw: {},
  };

  test("uses the bank's reference when there is one", () => {
    const key = dedupKey({ ...base, entryReference: "REF-123" });
    expect(key).toBe("ref:REF-123");
  });

  test("with no reference, it is a stable digest", () => {
    expect(dedupKey(base)).toBe(dedupKey({ ...base }));
    expect(dedupKey(base).startsWith("h:")).toBe(true);
  });

  test("does not depend on case or on spaces at the ends", () => {
    expect(dedupKey(base)).toBe(
      dedupKey({ ...base, description: "  compra mercadona  ", counterparty: " MERCADONA " }),
    );
  });

  test("changes if the amount, the date or the currency changes", () => {
    expect(dedupKey({ ...base, amount: "-45.21" })).not.toBe(dedupKey(base));
    expect(dedupKey({ ...base, bookingDate: "2026-03-02" })).not.toBe(dedupKey(base));
    expect(dedupKey({ ...base, currency: "USD" })).not.toBe(dedupKey(base));
  });

  test("never goes past the column's 64 characters", () => {
    const llarga = dedupKey({ ...base, entryReference: "R".repeat(200) });
    expect(llarga.length).toBeLessThanOrEqual(64);
    expect(dedupKey(base).length).toBeLessThanOrEqual(64);
  });
});

describe("what is discarded", () => {
  test("the states that are neither booked nor pending", () => {
    expect(
      parseTransaction({
        status: "RJCT",
        transaction_amount: { amount: "5.00", currency: "EUR" },
        booking_date: "2026-03-09",
      }),
    ).toBeNull();
  });

  test("those carrying no amount or date", () => {
    expect(parseTransaction({ status: "BOOK", booking_date: "2026-03-10" })).toBeNull();
    expect(
      parseTransaction({ status: "BOOK", transaction_amount: { amount: "5.00" } }),
    ).toBeNull();
  });
});

describe("the sign of the amount", () => {
  test("a debit comes out negative and a credit positive", () => {
    const deute = parseTransaction({
      status: "BOOK",
      transaction_amount: { amount: "45.20", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      booking_date: "2026-03-01",
    });
    const abonament = parseTransaction({
      status: "BOOK",
      transaction_amount: { amount: "45.20", currency: "EUR" },
      credit_debit_indicator: "CRDT",
      booking_date: "2026-03-01",
    });

    expect(deute?.amount).toBe("-45.20");
    expect(abonament?.amount).toBe("45.20");
  });
});
