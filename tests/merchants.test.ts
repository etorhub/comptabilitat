/**
 * Comerços: la memoria de cada espai.
 *
 * La invariant que es comprova aqui es la mes important de tota la
 * classificacio: **el que ha decidit una persona no ho sobreescriu res**.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

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
import { AppError } from "../src/lib/http.ts";
import {
  assignaCategoria,
  llistaComercos,
  obteOCreaComerc,
  reassignaNormalitzacio,
} from "../src/services/merchants.ts";
import { seedCategories } from "../src/services/seed.ts";

let ledgerId = 0;
let altreLedgerId = 0;
let accountId = 0;
let merchantId = 0;

async function categoriaPerSlug(slug: string, ledger = ledgerId) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledger), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta ${slug}`);
  return c;
}

async function moviment(dedupKey: string, source: "user" | "none", categoryId: number | null) {
  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey,
    source: "manual",
    bookingDate: "2026-02-01",
    amount: "-9.00",
    currency: "EUR",
    status: "booked",
    description: "Cafe",
    normalizedDescription: "BAR PEPE",
    counterparty: "Bar Pepe",
    bankTransactionCode: "",
    merchantId,
    categoryId,
    categorySource: source,
    needsReview: source === "none",
    notes: "",
    tags: [],
    isExcluded: false,
    raw: {},
  });
}

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const espais = await db
    .insert(ledgers)
    .values(
      ["personal", "calella"].map((code, i) => ({
        code,
        name: code,
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: i,
        isActive: true,
        alertRecipients: [],
      })),
    )
    .returning();
  ledgerId = espais.find((e) => e.code === "personal")?.id ?? 0;
  altreLedgerId = espais.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(ledgerId);
  await seedCategories(altreLedgerId);

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
      ebAccountUid: "uid-m",
      name: "C",
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
      normalizedName: "BAR PEPE",
      displayName: "Bar Pepe",
      defaultCategoryId: null,
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      lastSeenAt: null,
    })
    .returning();
  merchantId = comerc?.id ?? 0;
});

describe("assignar la categoria d'un comerç", () => {
  test("no toca mai el que ha classificat una persona", async () => {
    const restaurants = await categoriaPerSlug("restauracio-restaurants");
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");

    await moviment("meu", "user", restaurants.id);
    await moviment("automatic-1", "none", null);
    await moviment("automatic-2", "none", null);

    const canviats = await assignaCategoria(merchantId, ledgerId, bars.id);
    expect(canviats).toBe(2);

    const [meu] = await db.select().from(transactions).where(eq(transactions.dedupKey, "meu"));
    // Ni la categoria ni l'origen: la decisio de la persona mana.
    expect(meu?.categoryId).toBe(restaurants.id);
    expect(meu?.categorySource).toBe("user");

    const automatics = await db
      .select()
      .from(transactions)
      .where(eq(transactions.categorySource, "merchant"));
    expect(automatics).toHaveLength(2);
    expect(automatics.every((t) => t.categoryId === bars.id)).toBe(true);
    // I surten de la safata de revisio.
    expect(automatics.every((t) => t.needsReview === false)).toBe(true);
  });

  test("deixa el comerç confirmat", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await assignaCategoria(merchantId, ledgerId, bars.id);

    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(comerc?.isConfirmed).toBe(true);
    expect(comerc?.categorySource).toBe("user");
    expect(comerc?.defaultCategoryId).toBe(bars.id);
  });

  test("es pot demanar que no s'apliqui als que ja hi ha", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await moviment("automatic-1", "none", null);

    const canviats = await assignaCategoria(merchantId, ledgerId, bars.id, false);
    expect(canviats).toBe(0);

    const [t] = await db.select().from(transactions);
    expect(t?.categoryId).toBeNull();
  });

  test("no accepta una categoria d'un altre espai", async () => {
    const forana = await categoriaPerSlug("habitatge", altreLedgerId);
    await expect(assignaCategoria(merchantId, ledgerId, forana.id)).rejects.toThrow(AppError);
  });

  test("no accepta un comerç d'un altre espai", async () => {
    const [foraster] = await db
      .insert(merchants)
      .values({
        ledgerId: altreLedgerId,
        normalizedName: "ALTRE",
        displayName: "Altre",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();

    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await expect(assignaCategoria(foraster?.id ?? 0, ledgerId, bars.id)).rejects.toThrow();
  });
});

describe("obtenir o crear un comerç", () => {
  test("no en crea cap amb el nom buit", async () => {
    expect(await obteOCreaComerc(ledgerId, "   ")).toBeNull();
  });

  test("el mateix nom a dos espais son dos comerços diferents", async () => {
    const a = await obteOCreaComerc(ledgerId, "MERCADONA");
    const b = await obteOCreaComerc(altreLedgerId, "MERCADONA");

    expect(a?.id).not.toBe(b?.id);
    expect(a?.ledgerId).toBe(ledgerId);
    expect(b?.ledgerId).toBe(altreLedgerId);
  });

  test("compta les vegades i recorda l'ultima data", async () => {
    await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-01-10");
    const segon = await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-03-20");

    expect(segon?.transactionCount).toBe(2);
    expect(segon?.lastSeenAt).toBe("2026-03-20");

    // Una data anterior no fa recular l'ultima vista.
    const tercer = await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-02-01");
    expect(tercer?.lastSeenAt).toBe("2026-03-20");
  });
});

describe("la llista", () => {
  test("nomes ensenya els comerços d'aquest espai", async () => {
    await obteOCreaComerc(altreLedgerId, "FORASTER");
    const pagina = await llistaComercos(ledgerId, {
      cerca: "",
      nomesSenseClassificar: false,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.items.every((m) => m.normalizedName !== "FORASTER")).toBe(true);
  });

  test("la cerca mira el nom normalitzat i el que es veu", async () => {
    const pagina = await llistaComercos(ledgerId, {
      cerca: "pepe",
      nomesSenseClassificar: false,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.total).toBe(1);
    expect(pagina.items[0]?.displayName).toBe("Bar Pepe");
  });

  test("es poden demanar nomes els que no tenen categoria", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await obteOCreaComerc(ledgerId, "SENSE");
    await assignaCategoria(merchantId, ledgerId, bars.id);

    const pagina = await llistaComercos(ledgerId, {
      cerca: "",
      nomesSenseClassificar: true,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.items.every((m) => m.defaultCategoryId === null)).toBe(true);
    expect(pagina.items.some((m) => m.normalizedName === "SENSE")).toBe(true);
  });
});

describe("reassignar la normalitzacio", () => {
  test("treu una compra Spotify del cubell COMISSIO BANCARIA", async () => {
    const [cubell] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "COMISSIO BANCARIA",
        displayName: "Comissio Bancaria",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 1,
        lastSeenAt: null,
      })
      .returning();

    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "spotify-mal",
      source: "enablebanking",
      bookingDate: "2026-03-01",
      amount: "-10.99",
      currency: "EUR",
      status: "booked",
      description:
        "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
      normalizedDescription: "COMISSIO BANCARIA",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: cubell?.id ?? 0,
      categoryId: null,
      categorySource: "merchant",
      needsReview: true,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    const resultat = await reassignaNormalitzacio(ledgerId);
    expect(resultat.canviats).toBeGreaterThanOrEqual(1);

    const [t] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.dedupKey, "spotify-mal"));
    expect(t?.normalizedDescription).toBe("SPOTIFY");

    const [spotify] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.normalizedName, "SPOTIFY")));
    expect(spotify).toBeDefined();
    expect(t?.merchantId).toBe(spotify?.id);

    const [cubellDespres] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, cubell?.id ?? 0));
    expect(cubellDespres?.transactionCount).toBe(0);
    expect(spotify?.transactionCount).toBe(1);
  });

  test("no toca la categoria que ha posat una persona", async () => {
    const restaurants = await categoriaPerSlug("restauracio-restaurants");
    const [cubell] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "COMISSIO BANCARIA",
        displayName: "Comissio Bancaria",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 1,
        lastSeenAt: null,
      })
      .returning();

    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "user-spotify",
      source: "enablebanking",
      bookingDate: "2026-03-01",
      amount: "-10.99",
      currency: "EUR",
      status: "booked",
      description:
        "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
      normalizedDescription: "COMISSIO BANCARIA",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: cubell?.id ?? 0,
      categoryId: restaurants.id,
      categorySource: "user",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    await reassignaNormalitzacio(ledgerId);

    const [t] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.dedupKey, "user-spotify"));
    expect(t?.normalizedDescription).toBe("SPOTIFY");
    expect(t?.categoryId).toBe(restaurants.id);
    expect(t?.categorySource).toBe("user");
  });
});
