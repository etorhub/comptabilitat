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
import casos from "../fixtures/enablebanking.json";

interface Cas {
  raw: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

describe("es comporta igual que la implementacio de Python", () => {
  test(`${(casos as Cas[]).length} respostes gravades donen el mateix`, () => {
    for (const cas of casos as Cas[]) {
      const obtingut = parseTransaction(cas.raw);

      if (cas.expected === null) {
        expect(obtingut).toBeNull();
        continue;
      }

      expect(obtingut).not.toBeNull();
      const { raw, ...resta } = obtingut as NonNullable<typeof obtingut>;
      void raw;
      expect({
        ...resta,
        dedupKey: dedupKey(obtingut as NonNullable<typeof obtingut>),
      }).toEqual(cas.expected as never);
    }
  });
});

describe("la clau de deduplicacio", () => {
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

  test("fa servir la referencia del banc quan n'hi ha", () => {
    const key = dedupKey({ ...base, entryReference: "REF-123" });
    expect(key).toBe("ref:REF-123");
  });

  test("sense referencia, es un resum estable", () => {
    expect(dedupKey(base)).toBe(dedupKey({ ...base }));
    expect(dedupKey(base).startsWith("h:")).toBe(true);
  });

  test("no depen de majuscules ni d'espais als extrems", () => {
    expect(dedupKey(base)).toBe(
      dedupKey({ ...base, description: "  compra mercadona  ", counterparty: " MERCADONA " }),
    );
  });

  test("canvia si canvia l'import, la data o la moneda", () => {
    expect(dedupKey({ ...base, amount: "-45.21" })).not.toBe(dedupKey(base));
    expect(dedupKey({ ...base, bookingDate: "2026-03-02" })).not.toBe(dedupKey(base));
    expect(dedupKey({ ...base, currency: "USD" })).not.toBe(dedupKey(base));
  });

  test("mai passa dels 64 carácters de la columna", () => {
    const llarga = dedupKey({ ...base, entryReference: "R".repeat(200) });
    expect(llarga.length).toBeLessThanOrEqual(64);
    expect(dedupKey(base).length).toBeLessThanOrEqual(64);
  });
});

describe("el que es descarta", () => {
  test("els estats que no son ni definitiu ni pendent", () => {
    expect(
      parseTransaction({
        status: "RJCT",
        transaction_amount: { amount: "5.00", currency: "EUR" },
        booking_date: "2026-03-09",
      }),
    ).toBeNull();
  });

  test("els que no duen import o data", () => {
    expect(parseTransaction({ status: "BOOK", booking_date: "2026-03-10" })).toBeNull();
    expect(
      parseTransaction({ status: "BOOK", transaction_amount: { amount: "5.00" } }),
    ).toBeNull();
  });
});

describe("el signe de l'import", () => {
  test("un deute surt negatiu i un abonament positiu", () => {
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
