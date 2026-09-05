/**
 * Actors: qui hi ha a l'altra banda d'una transferencia.
 *
 * Tres coses es comproven aqui:
 *
 *   1. `resolContrapart` reparteix pel tipus d'operacio: nomes una
 *      transferencia fa actor, un Bizum o una compra continuen sent comerç.
 *   2. Un actor **mai** no classifica res: els seus moviments sempre queden
 *      pendents de revisar, encara que hi hagi una categoria de sobra.
 *   3. `migraActors` reparteix els comerços que nomes tenen moviments de
 *      transferencia, i deixa quiets els que tenen moviments barrejats.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  actorAliases,
  actors,
  bankConnections,
  categories,
  ledgers,
  merchants,
  transactions,
} from "../src/db/schema/index.ts";
import {
  actorDeLespai,
  confirmaActor,
  fusionaActors,
  lligaUsuari,
  obteOCreaActor,
} from "../src/services/actors.ts";
import { classificaMoviment } from "../src/services/classification.ts";
import { resolContrapart } from "../src/services/contraparts.ts";
import { migraActors } from "../src/workers/jobs/migra-actors.ts";
import { AppError, NotFoundError } from "../src/lib/http.ts";
import { seedCategories } from "../src/services/seed.ts";

let ledgerId = 0;
let accountId = 0;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(actorAliases);
  await db.delete(actors);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
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
      aspspName: "S",
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
      ebAccountUid: "uid-actors",
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
});

async function moviment(
  dedupKey: string,
  description: string,
  categoryId: number | null = null,
) {
  return db
    .insert(transactions)
    .values({
      accountId,
      ledgerId,
      dedupKey,
      source: "manual",
      bookingDate: "2026-05-10",
      amount: "-40.00",
      currency: "EUR",
      status: "booked",
      description,
      normalizedDescription: "",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: null,
      actorId: null,
      categoryId,
      categorySource: "none",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    })
    .returning();
}

describe("resolContrapart reparteix pel tipus d'operacio", () => {
  test("una transferencia fa actor, no comerç", async () => {
    const contrapart = await resolContrapart(ledgerId, {
      description: "TRANSFERENCIA DE JOAN GARCIA PEREZ",
      counterparty: "",
      bookingDate: "2026-05-10",
    });

    expect(contrapart.merchantId).toBeNull();
    expect(contrapart.actorId).not.toBeNull();

    const [actor] = await db
      .select()
      .from(actors)
      .where(eq(actors.id, contrapart.actorId ?? 0));
    expect(actor?.displayName).toBe("Joan Garcia Perez");
    expect(actor?.isConfirmed).toBe(false);
    expect(actor?.kind).toBe("desconegut");
  });

  test("un Bizum, encara que sigui entre persones, continua sent comerç", async () => {
    const contrapart = await resolContrapart(ledgerId, {
      description: "BIZUM DE JOAN GARCIA",
      counterparty: "",
      bookingDate: "2026-05-10",
    });

    expect(contrapart.actorId).toBeNull();
    expect(contrapart.merchantId).not.toBeNull();
  });

  test("una compra amb targeta continua sent comerç", async () => {
    const contrapart = await resolContrapart(ledgerId, {
      description: "COMPRA TARJ. MERCADONA BARCELONA",
      counterparty: "",
      bookingDate: "2026-05-10",
    });

    expect(contrapart.actorId).toBeNull();
    expect(contrapart.merchantId).not.toBeNull();
  });

  test("el mateix titular a dues transferencies reutilitza l'actor i puja el comptador", async () => {
    const primera = await resolContrapart(ledgerId, {
      description: "TRANSFERENCIA DE JOAN GARCIA PEREZ",
      counterparty: "",
      bookingDate: "2026-05-01",
    });
    const segona = await resolContrapart(ledgerId, {
      description: "TRANSFERENCIA DE JOAN GARCIA PEREZ",
      counterparty: "",
      bookingDate: "2026-05-15",
    });

    expect(segona.actorId).toBe(primera.actorId);
    const [actor] = await db
      .select()
      .from(actors)
      .where(eq(actors.id, primera.actorId ?? 0));
    expect(actor?.transactionCount).toBe(2);
    expect(actor?.lastSeenAt).toBe("2026-05-15");
  });
});

describe("un actor no classifica mai res", () => {
  test("un moviment amb actor pero sense categoria queda pendent de revisar", async () => {
    const contrapart = await resolContrapart(ledgerId, {
      description: "TRANSFERENCIA DE JOAN GARCIA",
      counterparty: "",
      bookingDate: "2026-05-10",
    });
    const [creat] = await moviment("m1", "TRANSFERENCIA DE JOAN GARCIA");

    const origen = await classificaMoviment({
      id: creat?.id ?? 0,
      ledgerId,
      merchantId: contrapart.merchantId,
      categorySource: "none",
    });

    expect(origen).toBe("none");
    const [fila] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, creat?.id ?? 0));
    expect(fila?.needsReview).toBe(true);
    expect(fila?.categoryId).toBeNull();
  });
});

describe("confirmar, lligar i fusionar actors", () => {
  test("confirmar canvia la mena i el nom, i marca isConfirmed", async () => {
    const actor = await obteOCreaActor(ledgerId, "JOAN GARCIA", "Joan Garcia");
    const confirmat = await confirmaActor(actor?.id ?? 0, ledgerId, {
      kind: "persona",
      displayName: "Joan Garcia Pérez",
    });
    expect(confirmat.kind).toBe("persona");
    expect(confirmat.isConfirmed).toBe(true);
    expect(confirmat.displayName).toBe("Joan Garcia Pérez");
  });

  test("lligar a un usuari inexistent es un 422", async () => {
    const actor = await obteOCreaActor(ledgerId, "JOAN GARCIA");
    await expect(lligaUsuari(actor?.id ?? 0, ledgerId, 999_999)).rejects.toThrow(AppError);
  });

  test("404 si l'actor es d'un altre espai", async () => {
    await expect(actorDeLespai(999_999, ledgerId)).rejects.toThrow(NotFoundError);
  });

  test("fusionar mou els alies i els moviments, i esborra el perdedor", async () => {
    const guanyador = await obteOCreaActor(ledgerId, "MARIA G LOPEZ", "Maria G Lopez");
    const perdedor = await obteOCreaActor(ledgerId, "MARIA GARCIA LOPEZ", "Maria Garcia Lopez");
    const [creat] = await moviment("m-fusio", "TRANSFERENCIA DE MARIA GARCIA LOPEZ");
    await db
      .update(transactions)
      .set({ actorId: perdedor?.id })
      .where(eq(transactions.id, creat?.id ?? 0));

    const resultat = await fusionaActors(guanyador?.id ?? 0, perdedor?.id ?? 0, ledgerId);
    expect(resultat.id).toBe(guanyador?.id ?? 0);
    expect(resultat.transactionCount).toBe(1);

    const [fila] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, creat?.id ?? 0));
    expect(fila?.actorId).toBe(guanyador?.id ?? 0);

    await expect(actorDeLespai(perdedor?.id ?? 0, ledgerId)).rejects.toThrow(NotFoundError);

    // L'alies del perdedor ara porta cap al guanyador: una futura sincronitzacio
    // amb aquell nom no en crea un altre.
    const trobat = await obteOCreaActor(ledgerId, "MARIA GARCIA LOPEZ");
    expect(trobat?.id).toBe(guanyador?.id);
  });
});

describe("migraActors", () => {
  test("un comerç amb nomes transferencies es converteix en actor", async () => {
    const [comerc] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "JOAN GARCIA",
        displayName: "Joan Garcia",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 2,
        lastSeenAt: null,
      })
      .returning();

    const restaurants = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, "restauracio-restaurants"))
      .limit(1);

    await db.insert(transactions).values([
      {
        accountId,
        ledgerId,
        dedupKey: "mig-1",
        source: "manual",
        bookingDate: "2026-04-01",
        amount: "-350.00",
        currency: "EUR",
        status: "booked",
        description: "TRANSFERENCIA A JOAN GARCIA",
        normalizedDescription: "JOAN GARCIA",
        counterparty: "",
        bankTransactionCode: "",
        merchantId: comerc?.id ?? null,
        categoryId: restaurants[0]?.id ?? null,
        categorySource: "user",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId,
        ledgerId,
        dedupKey: "mig-2",
        source: "manual",
        bookingDate: "2026-05-01",
        amount: "-350.00",
        currency: "EUR",
        status: "booked",
        description: "TRANSFERENCIA A JOAN GARCIA",
        normalizedDescription: "JOAN GARCIA",
        counterparty: "",
        bankTransactionCode: "",
        merchantId: comerc?.id ?? null,
        categoryId: null,
        categorySource: "none",
        needsReview: true,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
    ]);

    const resultat = await migraActors(ledgerId);
    expect(resultat.comercosConvertits).toBe(1);
    expect(resultat.movimentsRepuntats).toBe(2);

    const [comercEncara] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, comerc?.id ?? 0));
    expect(comercEncara).toBeUndefined();

    const files = await db
      .select()
      .from(transactions)
      .where(eq(transactions.dedupKey, "mig-1"));
    expect(files[0]?.merchantId).toBeNull();
    expect(files[0]?.actorId).not.toBeNull();
    // La categoria que ja tenia el moviment es conserva.
    expect(files[0]?.categoryId).toBe(restaurants[0]?.id ?? null);
  });

  test("un comerç amb moviments barrejats no es toca", async () => {
    const [comerc] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "MERCADONA",
        displayName: "Mercadona",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 2,
        lastSeenAt: null,
      })
      .returning();

    await db.insert(transactions).values([
      {
        accountId,
        ledgerId,
        dedupKey: "barrejat-1",
        source: "manual",
        bookingDate: "2026-04-01",
        amount: "-40.00",
        currency: "EUR",
        status: "booked",
        description: "COMPRA TARJ. MERCADONA",
        normalizedDescription: "MERCADONA",
        counterparty: "",
        bankTransactionCode: "",
        merchantId: comerc?.id ?? null,
        categoryId: null,
        categorySource: "none",
        needsReview: true,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId,
        ledgerId,
        dedupKey: "barrejat-2",
        source: "manual",
        bookingDate: "2026-05-01",
        amount: "-40.00",
        currency: "EUR",
        status: "booked",
        description: "TRANSFERENCIA A MERCADONA",
        normalizedDescription: "MERCADONA",
        counterparty: "",
        bankTransactionCode: "",
        merchantId: comerc?.id ?? null,
        categoryId: null,
        categorySource: "none",
        needsReview: true,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
    ]);

    const resultat = await migraActors(ledgerId);
    expect(resultat.comercosConvertits).toBe(0);

    const [comercEncara] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, comerc?.id ?? 0));
    expect(comercEncara).not.toBeUndefined();
  });
});
