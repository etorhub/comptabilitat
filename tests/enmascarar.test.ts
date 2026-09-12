/**
 * Transaction masking.
 *
 * Hiding a transaction's concept is a privacy feature: it is for the things
 * you do not want read by whoever looks at the screen over your shoulder. So
 * it is not enough that the concept is not drawn; **it must not be guessable
 * by searching for it either**.
 *
 * These tests are a translation of `backend/tests/test_enmascarar.py`, and
 * they are especially important in this architecture: since each fragment
 * draws its own piece, a new template that took the raw row would skip the
 * masking without anything breaking. That is why it all goes through `transactionView`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  merchants,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { listTransactions, transactionInWorkspace } from "../src/services/transactions.ts";
import { seedCategories } from "../src/services/seed.ts";

let ledgerId = 0;
let accountId = 0;
let merchantId = 0;
let idNormal = 0;
let idAmagat = 0;

const CAP_FILTER = {
  accountId: null,
  dateFrom: null,
  dateTo: null,
  categoryIds: [],
  merchantId: null,
  search: "",
  tag: null,
  operationType: [],
  cards: [],
  onlyReview: false,
  onlyUnclassified: false,
  includeTransfers: true,
  limit: 50,
  offset: 0,
};

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const [workspace] = await db
    .insert(ledgers)
    .values({
      code: "personal",
      name: "Personal",
      description: "",
      currency: "EUR",
      color: "#2563eb",
      overdraftThreshold: "0.00",
      position: 0,
      isActive: true,
      alertRecipients: [],
    })
    .returning();
  ledgerId = workspace?.id ?? 0;
  await seedCategories(ledgerId);

  const [connection] = await db
    .insert(bankConnections)
    .values({
      name: "P",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();
  const [account] = await db
    .insert(accounts)
    .values({
      connectionId: connection?.id ?? 0,
      ledgerId,
      ebAccountUid: "uid-mask",
      name: "Compte",
      product: "",
      iban: "ES00",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  accountId = account?.id ?? 0;

  const [merchant] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: "CLINICA DISCRETA",
      displayName: "Clinica Discreta",
      defaultCategoryId: null,
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      lastSeenAt: null,
    })
    .returning();
  merchantId = merchant?.id ?? 0;

  const base = {
    accountId,
    ledgerId,
    source: "manual" as const,
    bookingDate: "2026-03-01",
    amount: "-80.00",
    currency: "EUR",
    status: "booked" as const,
    normalizedDescription: "CLINICA DISCRETA",
    counterparty: "Clinica Discreta SL",
    bankTransactionCode: "",
    merchantId,
    categoryId: null,
    categorySource: "none" as const,
    needsReview: false,
    notes: "",
    tags: [],
    isExcluded: false,
    raw: { secret: "aixo no ha de sortir mai" },
  };

  const created = await db
    .insert(transactions)
    .values([
      { ...base, dedupKey: "normal", description: "COMPRA TARJ. CLINICA DISCRETA" },
      {
        ...base,
        dedupKey: "amagat",
        description: "COMPRA TARJ. CLINICA DISCRETA",
        displayDescription: "Despesa personal",
      },
    ])
    .returning({ id: transactions.id, dedupKey: transactions.dedupKey });

  idNormal = created.find((t) => t.dedupKey === "normal")?.id ?? 0;
  idAmagat = created.find((t) => t.dedupKey === "amagat")?.id ?? 0;
});

describe("a masked transaction", () => {
  test("shows the alias instead of the bank's concept", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.description).toBe("Despesa personal");
    expect(transaction.isMasked).toBe(true);
  });

  test("shows neither the counterparty nor the merchant", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.counterparty).toBe("");
    expect(transaction.merchantName).toBeNull();
  });

  test("leaves no trace of the bank's concept anywhere in the view", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    const serialitzat = JSON.stringify(transaction);

    expect(serialitzat).not.toContain("CLINICA");
    expect(serialitzat).not.toContain("Clinica");
    expect(serialitzat).not.toContain("COMPRA TARJ");
    // Nor the bank's raw response.
    expect(serialitzat).not.toContain("aixo no ha de sortir mai");
  });

  test("a transaction with a PAN does not leave it in the view", async () => {
    await db
      .update(transactions)
      .set({
        description:
          "COMPRA WWW.AMAZON*QE6I19905, LUXEMBOURG, TARJETA 5489010385484017 , COMISION 0,00",
      })
      .where(eq(transactions.id, idNormal));

    const transaction = await transactionInWorkspace(idNormal, ledgerId);
    const serialitzat = JSON.stringify(transaction);
    expect(transaction.description).toBe("Amazon");
    expect(transaction.darrers4).toBe("4017");
    expect(serialitzat).not.toContain("5489010385484017");
  });

  test("an ordinary transaction does show them", async () => {
    const transaction = await transactionInWorkspace(idNormal, ledgerId);
    expect(transaction.description).toBe("Clinica Discreta");
    expect(transaction.darrers4).toBeNull();
    expect(transaction.merchantName).toBe("Clinica Discreta");
    expect(transaction.isMasked).toBe(false);
  });

  test("a hidden transaction carries no card chip", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.darrers4).toBeNull();
    expect(transaction.descriptionHint).toBeNull();
  });
});

describe("the search", () => {
  test("does not find a hidden transaction by the bank's concept", async () => {
    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "CLINICA" });
    // Only what is not hidden may come out.
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idNormal);
  });

  test("nor by the counterparty", async () => {
    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "Discreta SL" });
    expect(page.items.every((t) => t.id !== idAmagat)).toBe(true);
  });

  test("it does find it by the alias", async () => {
    const page = await listTransactions(ledgerId, {
      ...CAP_FILTER,
      search: "Despesa personal",
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idAmagat);
  });

  test("and by the notes", async () => {
    await db
      .update(transactions)
      .set({ notes: "recordatori meu" })
      .where(eq(transactions.id, idAmagat));

    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "recordatori" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idAmagat);
  });
});

describe("removing the alias", () => {
  test("shows the bank's concept again", async () => {
    await db
      .update(transactions)
      .set({ displayDescription: null })
      .where(eq(transactions.id, idAmagat));

    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.isMasked).toBe(false);
    expect(transaction.description).toBe("Clinica Discreta");
    expect(transaction.merchantName).toBe("Clinica Discreta");
  });
});

describe("no query returns the bank's raw response", () => {
  test("neither in the list nor in the detail", async () => {
    const page = await listTransactions(ledgerId, CAP_FILTER);
    for (const transaction of page.items) {
      expect(Object.keys(transaction)).not.toContain("raw");
    }
    const detail = await transactionInWorkspace(idNormal, ledgerId);
    expect(Object.keys(detail)).not.toContain("raw");
  });
});
