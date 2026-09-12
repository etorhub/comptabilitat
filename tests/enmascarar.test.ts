/**
 * Emmascarament de moviments.
 *
 * Amagar el concepte d'un moviment es una funcio de privadesa: serveix per a
 * les coses que no vols que llegeixi qui miri la pantalla per sobre de
 * l'espatlla. Per tant no n'hi ha prou que el concepte no es dibuixi; **tampoc
 * no s'ha de poder endevinar cercant-lo**.
 *
 * Aquestes proves son la traduccio de `backend/tests/test_enmascarar.py`, i
 * son especialment importants en aquesta arquitectura: com que cada fragment
 * dibuixa el seu tros, una plantilla nova que agafés la fila crua se saltaria
 * l'emmascarament sense que res petes. Per aixo tot passa per `vistaMoviment`.
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
  tipusOperacio: [],
  cards: [],
  nomesRevisio: false,
  nomesSenseClassificar: false,
  incloTraspassos: true,
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

describe("un moviment emmascarat", () => {
  test("ensenya l'alies en lloc del concepte del banc", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.description).toBe("Despesa personal");
    expect(transaction.isMasked).toBe(true);
  });

  test("no ensenya ni la contrapart ni el comerç", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.counterparty).toBe("");
    expect(transaction.merchantName).toBeNull();
  });

  test("no deixa rastre del concepte del banc enlloc de la vista", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    const serialitzat = JSON.stringify(transaction);

    expect(serialitzat).not.toContain("CLINICA");
    expect(serialitzat).not.toContain("Clinica");
    expect(serialitzat).not.toContain("COMPRA TARJ");
    // I tampoc la resposta crua del banc.
    expect(serialitzat).not.toContain("aixo no ha de sortir mai");
  });

  test("un moviment amb PAN no el deixa a la vista", async () => {
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

  test("un moviment normal si que els ensenya", async () => {
    const transaction = await transactionInWorkspace(idNormal, ledgerId);
    expect(transaction.description).toBe("Clinica Discreta");
    expect(transaction.darrers4).toBeNull();
    expect(transaction.merchantName).toBe("Clinica Discreta");
    expect(transaction.isMasked).toBe(false);
  });

  test("un moviment amagat no porta xip de targeta", async () => {
    const transaction = await transactionInWorkspace(idAmagat, ledgerId);
    expect(transaction.darrers4).toBeNull();
    expect(transaction.descriptionHint).toBeNull();
  });
});

describe("la cerca", () => {
  test("no troba un moviment amagat pel concepte del banc", async () => {
    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "CLINICA" });
    // Nomes hi ha de sortir el que no esta amagat.
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idNormal);
  });

  test("tampoc per la contrapart", async () => {
    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "Discreta SL" });
    expect(page.items.every((t) => t.id !== idAmagat)).toBe(true);
  });

  test("si que el troba per l'alies", async () => {
    const page = await listTransactions(ledgerId, {
      ...CAP_FILTER,
      search: "Despesa personal",
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idAmagat);
  });

  test("i per les notes", async () => {
    await db
      .update(transactions)
      .set({ notes: "recordatori meu" })
      .where(eq(transactions.id, idAmagat));

    const page = await listTransactions(ledgerId, { ...CAP_FILTER, search: "recordatori" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(idAmagat);
  });
});

describe("treure l'alies", () => {
  test("torna a ensenyar el concepte del banc", async () => {
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

describe("cap consulta no torna la resposta crua del banc", () => {
  test("ni a la llista ni al detall", async () => {
    const page = await listTransactions(ledgerId, CAP_FILTER);
    for (const transaction of page.items) {
      expect(Object.keys(transaction)).not.toContain("raw");
    }
    const detail = await transactionInWorkspace(idNormal, ledgerId);
    expect(Object.keys(detail)).not.toContain("raw");
  });
});
