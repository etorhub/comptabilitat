/**
 * Deteccio de series recurrents.
 *
 * Traduccio de la part de `backend/tests/test_recurring_forecast.py` que mira
 * la deteccio. La regla es: tres aparicions o mes, a intervals prou regulars,
 * amb un import prou estable.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  alerts,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
} from "../src/db/schema/index.ts";
import { detectaRecurrents } from "../src/services/recurring.ts";
import { llistaSeries, resumSubscripcions } from "../src/services/recurring-list.ts";
import { seedCategories } from "../src/services/seed.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";

let ledgerId = 0;
let accountId = 0;

/** Insereix un moviment amb un comerç concret. */
async function moviment(
  clau: string,
  data: string,
  quantitat: string,
  comercId: number | null,
  extra: Partial<{ transferGroupId: string; isExcluded: boolean }> = {},
) {
  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey: clau,
    source: "manual",
    bookingDate: data,
    amount: quantitat,
    currency: "EUR",
    status: "booked",
    description: "Rebut",
    normalizedDescription: "REBUT GENERIC",
    counterparty: "",
    bankTransactionCode: "",
    merchantId: comercId,
    categoryId: null,
    categorySource: "none",
    needsReview: false,
    transferGroupId: extra.transferGroupId ?? null,
    notes: "",
    tags: [],
    isExcluded: extra.isExcluded ?? false,
    raw: {},
  });
}

async function comerc(nom: string): Promise<number> {
  const [m] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: nom,
      displayName: nom,
      defaultCategoryId: null,
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      lastSeenAt: null,
    })
    .returning();
  return m?.id ?? 0;
}

beforeEach(async () => {
  await db.delete(recurringOccurrences);
  await db.delete(recurringSeries);
  await db.delete(transactions);
  await db.delete(alerts);
  await db.delete(merchants);
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
      ebAccountUid: "uid-rec",
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

describe("que es reconeix com a serie", () => {
  test("tres rebuts mensuals iguals si", async () => {
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", netflix);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const [serie] = await llistaSeries(ledgerId, false, true);
    expect(serie?.cadence).toBe("monthly");
    expect(serie?.expectedAmount).toBe("-12.99");
    // Mensual i surt diners: es una subscripcio.
    expect(serie?.isSubscription).toBe(true);
  });

  test("nomes dues aparicions, no", async () => {
    const m = await comerc("NOMES DUES");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -60), "-10.00", m);
    await moviment("b", addDays(avui, -30), "-10.00", m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("tres aparicions a intervals irregulars, no", async () => {
    const m = await comerc("IRREGULAR");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -100), "-10.00", m);
    await moviment("b", addDays(avui, -43), "-10.00", m);
    await moviment("c", addDays(avui, -2), "-10.00", m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("un ingres regular tambe es una serie, pero no una subscripcio", async () => {
    const feina = await comerc("EMPRESA");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`s${i}`, addDays(avui, -dies), "1800.00", feina);
    }

    await detectaRecurrents(ledgerId);
    const [serie] = await llistaSeries(ledgerId, false, true);
    expect(serie?.isSubscription).toBe(false);
  });

  test("els traspassos entre comptes propis no compten", async () => {
    const m = await comerc("TRASPAS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`t${i}`, addDays(avui, -dies), "-50.00", m, { transferGroupId: "g1" });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("els moviments exclosos tampoc", async () => {
    const m = await comerc("EXCLOS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`e${i}`, addDays(avui, -dies), "-50.00", m, { isExcluded: true });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });
});

describe("tornar a detectar", () => {
  test("actualitza la serie en lloc de duplicar-la", async () => {
    const m = await comerc("SPOTIFY");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`p${i}`, addDays(avui, -dies), "-10.99", m);
    }

    await detectaRecurrents(ledgerId);
    const segona = await detectaRecurrents(ledgerId);

    expect(segona.creades).toBe(0);
    expect(segona.actualitzades).toBe(1);
    expect(await llistaSeries(ledgerId, false, true)).toHaveLength(1);
  });

  test("avisa quan l'import s'aparta del que era habitual", async () => {
    const m = await comerc("GIMNAS");
    const avui = todayLocal();
    for (const [i, dies] of [120, 90, 60].entries()) {
      await moviment(`g${i}`, addDays(avui, -dies), "-30.00", m);
    }
    await detectaRecurrents(ledgerId);

    // Un rebut molt mes car que els altres.
    await moviment("g-car", addDays(avui, -30), "-45.00", m);
    const stats = await detectaRecurrents(ledgerId);

    expect(stats.avisos).toBe(1);
    const [avis] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.type, "recurring_amount_change"));
    expect(avis?.title).toContain("puja");
  });
});

describe("el resum de subscripcions", () => {
  test("suma nomes les subscripcions actives que treuen diners", async () => {
    const avui = todayLocal();
    const netflix = await comerc("NETFLIX");
    const feina = await comerc("EMPRESA");
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-10.00", netflix);
      await moviment(`s${i}`, addDays(avui, -dies), "2000.00", feina);
    }
    await detectaRecurrents(ledgerId);

    const resum = await resumSubscripcions(ledgerId);
    // 10 EUR al mes repartits sobre un interval de 30 dies.
    expect(Number(resum.mensual)).toBeCloseTo(10, 1);
    expect(Number(resum.anual)).toBeCloseTo(120, 1);
  });

  test("una serie acabada deixa de comptar", async () => {
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-10.00", netflix);
    }
    await detectaRecurrents(ledgerId);

    await db
      .update(recurringSeries)
      .set({ status: "ended" })
      .where(eq(recurringSeries.ledgerId, ledgerId));

    const resum = await resumSubscripcions(ledgerId);
    expect(Number(resum.mensual)).toBe(0);
  });
});

describe("les aparicions", () => {
  test("queden enllaçades amb la serie i no es dupliquen", async () => {
    const m = await comerc("LLUM");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`l${i}`, addDays(avui, -dies), "-55.00", m);
    }

    await detectaRecurrents(ledgerId);
    await detectaRecurrents(ledgerId);

    const [serie] = await db.select().from(recurringSeries).where(eq(recurringSeries.ledgerId, ledgerId));
    const aparicions = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.seriesId, serie?.id ?? 0));
    expect(aparicions).toHaveLength(3);
  });
});
