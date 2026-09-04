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
import { llistaMoviments, movimentDeLespai } from "../src/services/transactions.ts";
import { seedCategories } from "../src/services/seed.ts";

let ledgerId = 0;
let accountId = 0;
let merchantId = 0;
let idNormal = 0;
let idAmagat = 0;

const CAP_FILTRE = {
  accountId: null,
  dataDes: null,
  dataFins: null,
  categoryIds: [],
  merchantId: null,
  cerca: "",
  etiqueta: null,
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

  const [espai] = await db
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
  ledgerId = espai?.id ?? 0;
  await seedCategories(ledgerId);

  const [connexio] = await db
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
  const [compte] = await db
    .insert(accounts)
    .values({
      connectionId: connexio?.id ?? 0,
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
  accountId = compte?.id ?? 0;

  const [comerc] = await db
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
  merchantId = comerc?.id ?? 0;

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

  const creats = await db
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

  idNormal = creats.find((t) => t.dedupKey === "normal")?.id ?? 0;
  idAmagat = creats.find((t) => t.dedupKey === "amagat")?.id ?? 0;
});

describe("un moviment emmascarat", () => {
  test("ensenya l'alies en lloc del concepte del banc", async () => {
    const moviment = await movimentDeLespai(idAmagat, ledgerId);
    expect(moviment.description).toBe("Despesa personal");
    expect(moviment.isMasked).toBe(true);
  });

  test("no ensenya ni la contrapart ni el comerç", async () => {
    const moviment = await movimentDeLespai(idAmagat, ledgerId);
    expect(moviment.counterparty).toBe("");
    expect(moviment.merchantName).toBeNull();
  });

  test("no deixa rastre del concepte del banc enlloc de la vista", async () => {
    const moviment = await movimentDeLespai(idAmagat, ledgerId);
    const serialitzat = JSON.stringify(moviment);

    expect(serialitzat).not.toContain("CLINICA");
    expect(serialitzat).not.toContain("Clinica");
    expect(serialitzat).not.toContain("COMPRA TARJ");
    // I tampoc la resposta crua del banc.
    expect(serialitzat).not.toContain("aixo no ha de sortir mai");
  });

  test("un moviment normal si que els ensenya", async () => {
    const moviment = await movimentDeLespai(idNormal, ledgerId);
    expect(moviment.description).toBe("COMPRA TARJ. CLINICA DISCRETA");
    expect(moviment.merchantName).toBe("Clinica Discreta");
    expect(moviment.isMasked).toBe(false);
  });
});

describe("la cerca", () => {
  test("no troba un moviment amagat pel concepte del banc", async () => {
    const pagina = await llistaMoviments(ledgerId, { ...CAP_FILTRE, cerca: "CLINICA" });
    // Nomes hi ha de sortir el que no esta amagat.
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.id).toBe(idNormal);
  });

  test("tampoc per la contrapart", async () => {
    const pagina = await llistaMoviments(ledgerId, { ...CAP_FILTRE, cerca: "Discreta SL" });
    expect(pagina.items.every((t) => t.id !== idAmagat)).toBe(true);
  });

  test("si que el troba per l'alies", async () => {
    const pagina = await llistaMoviments(ledgerId, {
      ...CAP_FILTRE,
      cerca: "Despesa personal",
    });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.id).toBe(idAmagat);
  });

  test("i per les notes", async () => {
    await db
      .update(transactions)
      .set({ notes: "recordatori meu" })
      .where(eq(transactions.id, idAmagat));

    const pagina = await llistaMoviments(ledgerId, { ...CAP_FILTRE, cerca: "recordatori" });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.id).toBe(idAmagat);
  });
});

describe("treure l'alies", () => {
  test("torna a ensenyar el concepte del banc", async () => {
    await db
      .update(transactions)
      .set({ displayDescription: null })
      .where(eq(transactions.id, idAmagat));

    const moviment = await movimentDeLespai(idAmagat, ledgerId);
    expect(moviment.isMasked).toBe(false);
    expect(moviment.description).toBe("COMPRA TARJ. CLINICA DISCRETA");
    expect(moviment.merchantName).toBe("Clinica Discreta");
  });
});

describe("cap consulta no torna la resposta crua del banc", () => {
  test("ni a la llista ni al detall", async () => {
    const pagina = await llistaMoviments(ledgerId, CAP_FILTRE);
    for (const moviment of pagina.items) {
      expect(Object.keys(moviment)).not.toContain("raw");
    }
    const detall = await movimentDeLespai(idNormal, ledgerId);
    expect(Object.keys(detall)).not.toContain("raw");
  });
});
