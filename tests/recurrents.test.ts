/**
 * Deteccio de series recurrents (schedules).
 *
 * El detector mira l'historic categoritzat i **nomes proposa** series
 * (`status: suggested`, fora de la previsio). Calen ≥3 aparicions a intervals
 * regulars; no hi ha porta de categoria ni marca de subscripcio. La persona
 * confirma (`confirmaSerie` → `active`) o descarta a `/recurrents`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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
  type CategoryKind,
} from "../src/db/schema/index.ts";
import {
  comprovaRebutsQueFalten,
  confirmaSerie,
  detectaRecurrents,
} from "../src/services/recurring.ts";
import { llistaSeries } from "../src/services/recurring-list.ts";
import { seedCategories } from "../src/services/seed.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";

let ledgerId = 0;
let accountId = 0;

/** Insereix un moviment amb una categoria (i, opcionalment, un comerç) concrets. */
async function moviment(
  clau: string,
  data: string,
  quantitat: string,
  categoryId: number | null,
  comercId: number | null = null,
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
    categoryId,
    categorySource: categoryId === null ? "none" : "user",
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

async function categoria(slug: string, opts: { kind?: CategoryKind } = {}): Promise<number> {
  const [c] = await db
    .insert(categories)
    .values({
      ledgerId,
      parentId: null,
      slug,
      name: slug,
      kind: opts.kind ?? "expense",
      color: "#000000",
      icon: "",
      isSystem: false,
      position: 0,
    })
    .returning();
  return c?.id ?? 0;
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

describe("cal categoritzar", () => {
  test("un moviment sense categoria no genera res encara que la resta ho siguin", async () => {
    const c = await categoria("subscripcions");
    const m = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", i === 0 ? null : c, m);
    }

    // Nomes dues de les tres tenen categoria: no arriba al minim d'aparicions.
    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("el mateix comerç amb dues categories fa series separades", async () => {
    const lloguer = await categoria("lloguer");
    const sopars = await categoria("sopars-ocasionals");
    const m = await comerc("MARIA GARCIA");
    const avui = todayLocal();

    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`ll${i}`, addDays(avui, -dies), "-350.00", lloguer, m);
    }
    // Un sol sopar: no arriba a 3 aparicions.
    await moviment("sopar", addDays(avui, -5), "-42.50", sopars, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const series = await llistaSeries(ledgerId);
    expect(series).toHaveLength(1);
    expect(series[0]?.categoryId).toBe(lloguer);
    expect(series[0]?.status).toBe("suggested");
    expect(series[0]?.includeInForecast).toBe(false);
  });
});

describe("que es reconeix com a serie", () => {
  test("tres rebuts mensuals iguals creen una proposta suggested", async () => {
    const c = await categoria("subscripcions");
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, netflix);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const [serie] = await llistaSeries(ledgerId);
    expect(serie?.cadence).toBe("monthly");
    expect(serie?.expectedAmount).toBe("-12.99");
    expect(serie?.status).toBe("suggested");
    expect(serie?.includeInForecast).toBe(false);
  });

  test("confirmaSerie la passa a active i a la previsio", async () => {
    const c = await categoria("subscripcions");
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, netflix);
    }
    await detectaRecurrents(ledgerId);
    const proposta = (await llistaSeries(ledgerId, { estats: ["suggested"] }))[0];
    expect(proposta).toBeDefined();
    if (!proposta) throw new Error("calia una proposta");

    await confirmaSerie(proposta.id, { cadence: "monthly", amountMode: "exact" });

    const [activa] = await llistaSeries(ledgerId, { estats: ["active"] });
    expect(activa?.status).toBe("active");
    expect(activa?.includeInForecast).toBe(true);
    expect(activa?.cadence).toBe("monthly");
  });

  test("nomes dues aparicions, no", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("NOMES DUES");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -60), "-10.00", c, m);
    await moviment("b", addDays(avui, -30), "-10.00", c, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("tres aparicions a intervals irregulars, no", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("IRREGULAR");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -100), "-10.00", c, m);
    await moviment("b", addDays(avui, -43), "-10.00", c, m);
    await moviment("c", addDays(avui, -2), "-10.00", c, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("un ingres regular tambe es una serie", async () => {
    const c = await categoria("nomina", { kind: "income" });
    const feina = await comerc("EMPRESA");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`s${i}`, addDays(avui, -dies), "1800.00", c, feina);
    }

    await detectaRecurrents(ledgerId);
    const [serie] = await llistaSeries(ledgerId);
    expect(serie?.status).toBe("suggested");
    expect(serie?.expectedAmount).toBe("1800.00");
  });

  test("els traspassos entre comptes propis no compten", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("TRASPAS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`t${i}`, addDays(avui, -dies), "-50.00", c, m, { transferGroupId: "g1" });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("els moviments exclosos tampoc", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("EXCLOS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`e${i}`, addDays(avui, -dies), "-50.00", c, m, { isExcluded: true });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("dos comerços a la mateixa categoria fan series separades", async () => {
    const c = await categoria("subscripcions");
    const netflix = await comerc("NETFLIX");
    const spotify = await comerc("SPOTIFY");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, netflix);
      await moviment(`s${i}`, addDays(avui, -dies), "-10.99", c, spotify);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(2);
    expect(await llistaSeries(ledgerId)).toHaveLength(2);
  });
});

describe("tornar a detectar", () => {
  test("actualitza la serie suggested en lloc de duplicar-la", async () => {
    const c = await categoria("subscripcions");
    const m = await comerc("SPOTIFY");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`p${i}`, addDays(avui, -dies), "-10.99", c, m);
    }

    await detectaRecurrents(ledgerId);
    const segona = await detectaRecurrents(ledgerId);

    expect(segona.creades).toBe(0);
    expect(segona.actualitzades).toBe(1);
    expect(await llistaSeries(ledgerId)).toHaveLength(1);
  });

  test("avisa quan l'import d'una serie active exact s'aparta", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("GIMNAS");
    const avui = todayLocal();
    for (const [i, dies] of [120, 90, 60].entries()) {
      await moviment(`g${i}`, addDays(avui, -dies), "-30.00", c, m);
    }
    await detectaRecurrents(ledgerId);
    const proposta = (await llistaSeries(ledgerId, { estats: ["suggested"] }))[0];
    expect(proposta).toBeDefined();
    if (!proposta) throw new Error("calia una proposta");
    await confirmaSerie(proposta.id, { cadence: "monthly", amountMode: "exact" });

    // Un rebut molt mes car que els altres.
    await moviment("g-car", addDays(avui, -30), "-45.00", c, m);
    const stats = await detectaRecurrents(ledgerId);

    expect(stats.avisos).toBe(1);
    const [avis] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.type, "recurring_amount_change"));
    expect(avis?.title).toContain("puja");
  });
});

describe("les aparicions", () => {
  test("queden enllaçades amb la serie i no es dupliquen", async () => {
    const c = await categoria("recurrent-auto");
    const m = await comerc("LLUM");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`l${i}`, addDays(avui, -dies), "-55.00", c, m);
    }

    await detectaRecurrents(ledgerId);
    await detectaRecurrents(ledgerId);

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    const aparicions = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.seriesId, serie?.id ?? 0));
    expect(aparicions).toHaveLength(3);
  });
});

describe("rebuts que falten", () => {
  test("comprovaRebutsQueFalten avisa d'una serie active exact retardada", async () => {
    const c = await categoria("gimnas");
    const m = await comerc("GIMNAS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`g${i}`, addDays(avui, -dies), "-35.00", c, m);
    }
    await detectaRecurrents(ledgerId);
    const proposta = (await llistaSeries(ledgerId, { estats: ["suggested"] }))[0];
    expect(proposta).toBeDefined();
    if (!proposta) throw new Error("calia una proposta");
    await confirmaSerie(proposta.id, { cadence: "monthly", amountMode: "exact" });

    await db
      .update(recurringSeries)
      .set({ nextExpectedDate: addDays(avui, -10), intervalDays: 30 })
      .where(eq(recurringSeries.ledgerId, ledgerId));

    const avisos = await comprovaRebutsQueFalten(ledgerId);
    expect(avisos).toBe(1);

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    // Exactes confirmades es queden actives; nomes avisen.
    expect(serie?.status).toBe("active");
  });
});
