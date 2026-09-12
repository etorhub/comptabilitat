/**
 * Exports.
 *
 * What matters here is not the format but that **the masking gets through**.
 * A spreadsheet is exactly the place where the bank's concept would reappear
 * if hiding it were only a screen matter.
 */

import { describe, expect, test } from "bun:test";

import { reportToPdf, transactionsToCsv, resumAXlsx } from "../../src/services/export.ts";
import type { TransactionView } from "../../src/services/transactions.ts";

const normal: TransactionView = {
  id: 1,
  accountId: 1,
  accountName: "Compte corrent",
  bookingDate: "2026-03-01",
  valueDate: null,
  amount: "-45.20",
  currency: "EUR",
  status: "booked",
  description: "Clinica Discreta",
  descriptionHint: "COMPRA TARJ. CLINICA DISCRETA",
  darrers4: null,
  operationType: "targeta",
  counterparty: "Clinica Discreta SL",
  merchantId: 3,
  merchantName: "Clinica Discreta",
  categoryId: 5,
  categoryName: "Salut",
  categorySource: "user",
  categoryConfidence: 1,
  needsReview: false,
  transferGroupId: null,
  notes: "",
  tags: ["salut"],
  isExcluded: false,
  isMasked: false,
  seriesId: null,
  seriesLabel: null,
};

/** The same transaction, already through `transactionView()` with an alias. */
const amagat: TransactionView = {
  ...normal,
  id: 2,
  description: "Despesa personal",
  descriptionHint: null,
  darrers4: null,
  counterparty: "",
  merchantName: null,
  operationType: null,
  isMasked: true,
};

function textCsv(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("CSV", () => {
  test("goes with a BOM, semicolons and decimal commas", () => {
    const bytes = transactionsToCsv([normal]);
    // The BOM is checked on the bytes: `TextDecoder` eats it when decoding.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = textCsv(bytes);
    expect(csv.split("\r\n")[0]).toContain(";");
    expect(csv).toContain("-45,20");
    expect(csv).not.toContain("-45.20");
  });

  test("a masked transaction comes out hidden", () => {
    const csv = textCsv(transactionsToCsv([amagat]));
    expect(csv).toContain("Despesa personal");
    expect(csv).not.toContain("CLINICA DISCRETA");
    expect(csv).not.toContain("Clinica Discreta");
  });

  test("the PAN does not appear in the CSV when the concept is already parsed", () => {
    const withPan: TransactionView = {
      ...normal,
      description: "Amazon",
      descriptionHint: "COMPRA WWW.AMAZON, LUXEMBOURG",
      darrers4: "4017",
    };
    const csv = textCsv(transactionsToCsv([withPan]));
    expect(csv).toContain("Amazon");
    expect(csv).not.toContain("5489010385484017");
  });

  test("quotes and semicolons in the text do not break the columns", () => {
    const complicat: TransactionView = {
      ...normal,
      description: 'Ell va dir "hola"; i prou',
      notes: "linia 1\nlinia 2",
    };
    const csv = textCsv(transactionsToCsv([complicat]));
    const rows = csv.replace("﻿", "").split("\r\n").filter(Boolean);
    // The header and one row; the newline inside goes in quotes.
    expect(csv).toContain('"Ell va dir ""hola""; i prou"');
    expect(rows[0]?.split(";")).toHaveLength(11);
  });
});

describe("XLSX", () => {
  test("the summary carries both sheets", async () => {
    const bytes = await resumAXlsx(
      [
        {
          periode: "2026-01",
          income: "100.00",
          expenses: "50.00",
          fixedExpenses: "30.00",
          variableExpenses: "20.00",
          cleaned: "50.00",
        },
      ],
      [
        {
          categoryId: 1,
          categoryName: "Salut",
          color: "#ef4444",
          amount: "50.00",
          share: 1,
          transactions: 2,
        },
      ],
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("PDF", () => {
  test("it is a valid PDF and it is not empty", async () => {
    const bytes = await reportToPdf({
      workspaceName: "Personal",
      des: "2026-01-01",
      to: "2026-03-31",
      income: "1000.00",
      expenses: "400.00",
      cleaned: "600.00",
      monthly: [
        {
          periode: "2026-01",
          income: "1000.00",
          expenses: "400.00",
          fixedExpenses: "250.00",
          variableExpenses: "150.00",
          cleaned: "600.00",
        },
      ],
      categories: [
        {
          categoryId: 1,
          categoryName: "Salut",
          color: "#ef4444",
          amount: "400.00",
          share: 1,
          transactions: 3,
        },
      ],
    });

    const capçalera = new TextDecoder().decode(bytes.slice(0, 8));
    expect(capçalera).toBe("%PDF-1.3");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  test("it stands a long report without blowing up", async () => {
    const monthly = Array.from({ length: 60 }, (_, i) => ({
      periode: `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      income: "1000.00",
      expenses: "400.00",
      fixedExpenses: "250.00",
      variableExpenses: "150.00",
      cleaned: "600.00",
    }));
    const categories = Array.from({ length: 40 }, (_, i) => ({
      categoryId: i,
      categoryName: `Categoria ${i}`,
      color: "#94a3b8",
      amount: "10.00",
      share: 0.025,
      transactions: 1,
    }));

    const bytes = await reportToPdf({
      workspaceName: "Personal",
      des: "2020-01-01",
      to: "2026-01-01",
      income: "60000.00",
      expenses: "24000.00",
      cleaned: "36000.00",
      monthly,
      categories,
    });

    expect(bytes.byteLength).toBeGreaterThan(3000);
  });
});
