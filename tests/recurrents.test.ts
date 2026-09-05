/**
 * Deteccio de series recurrents.
 *
 * La porta es la **categoria**: nomes hi entren els moviments d'una
 * categoria marcada `is_recurrent` (`services/categories.ts`, `marcaRecurrent`).
 * Dins d'una categoria recurrent, la regla de sempre: tres aparicions o mes, a
 * intervals prou regulars, amb un import prou estable — llevat que la
 * categoria porti una cadencia declarada, que llavors n'hi ha prou amb una.
 *
 * Traduccio de la part de `backend/tests/test_recurring_forecast.py` que mira
 * la deteccio, adaptada al canvi de porta (`0002_actors_i_recurrents`).
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
  type Cadence,
  type CategoryKind,
} from "../src/db/schema/index.ts";
import { marcaRecurrent } from "../src/services/categories.ts";
import { comprovaRebutsQueFalten, detectaRecurrents } from "../src/services/recurring.ts";
import { llistaSeries, resumSubscripcions } from "../src/services/recurring-list.ts";
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

/** Una categoria ad-hoc, opcionalment marcada com a porta del detector. */
async function categoria(
  slug: string,
  opts: {
    isRecurrent?: boolean;
    cadence?: Cadence | null;
    isSubscription?: boolean;
    kind?: CategoryKind;
  } = {},
): Promise<number> {
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
      isSubscription: opts.isSubscription ?? false,
      isRecurrent: opts.isRecurrent ?? false,
      recurrentCadence: opts.cadence ?? null,
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

describe("la categoria com a porta", () => {
  test("una categoria no marcada com a recurrent no genera cap serie, per regular que sigui", async () => {
    const c = await categoria("sense-marcar");
    const m = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, m);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
    expect(await llistaSeries(ledgerId, false, true)).toHaveLength(0);
  });

  test("un moviment sense categoria no genera res encara que la resta ho siguin", async () => {
    const c = await categoria("subscripcions", { isRecurrent: true });
    const m = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", i === 0 ? null : c, m);
    }

    // Nomes dues de les tres tenen categoria: no arriba al minim d'aparicions.
    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("el mateix comerç amb una categoria recurrent i una que no ho es: nomes la primera genera serie", async () => {
    const lloguer = await categoria("lloguer", { isRecurrent: true });
    const sopars = await categoria("sopars-ocasionals");
    const m = await comerc("MARIA GARCIA");
    const avui = todayLocal();

    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`ll${i}`, addDays(avui, -dies), "-350.00", lloguer, m);
    }
    await moviment("sopar", addDays(avui, -5), "-42.50", sopars, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const series = await llistaSeries(ledgerId, false, true);
    expect(series).toHaveLength(1);
    expect(series[0]?.categoryId).toBe(lloguer);
  });
});

describe("que es reconeix com a serie", () => {
  test("tres rebuts mensuals iguals si", async () => {
    const c = await categoria("subscripcions", { isRecurrent: true, isSubscription: true });
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, netflix);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const [serie] = await llistaSeries(ledgerId, false, true);
    expect(serie?.cadence).toBe("monthly");
    expect(serie?.expectedAmount).toBe("-12.99");
    // La subscripcio ve de la categoria, no es deriva de l'import ni del signe.
    expect(serie?.isSubscription).toBe(true);
  });

  test("nomes dues aparicions, no", async () => {
    const c = await categoria("recurrent-auto", { isRecurrent: true });
    const m = await comerc("NOMES DUES");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -60), "-10.00", c, m);
    await moviment("b", addDays(avui, -30), "-10.00", c, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("tres aparicions a intervals irregulars, no", async () => {
    const c = await categoria("recurrent-auto", { isRecurrent: true });
    const m = await comerc("IRREGULAR");
    const avui = todayLocal();
    await moviment("a", addDays(avui, -100), "-10.00", c, m);
    await moviment("b", addDays(avui, -43), "-10.00", c, m);
    await moviment("c", addDays(avui, -2), "-10.00", c, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("un ingres regular tambe es una serie, pero no una subscripcio", async () => {
    const c = await categoria("nomina", { isRecurrent: true, kind: "income" });
    const feina = await comerc("EMPRESA");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`s${i}`, addDays(avui, -dies), "1800.00", c, feina);
    }

    await detectaRecurrents(ledgerId);
    const [serie] = await llistaSeries(ledgerId, false, true);
    expect(serie?.isSubscription).toBe(false);
  });

  test("els traspassos entre comptes propis no compten", async () => {
    const c = await categoria("recurrent-auto", { isRecurrent: true });
    const m = await comerc("TRASPAS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`t${i}`, addDays(avui, -dies), "-50.00", c, m, { transferGroupId: "g1" });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("els moviments exclosos tampoc", async () => {
    const c = await categoria("recurrent-auto", { isRecurrent: true });
    const m = await comerc("EXCLOS");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`e${i}`, addDays(avui, -dies), "-50.00", c, m, { isExcluded: true });
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("dos comerços a la mateixa categoria recurrent fan series separades", async () => {
    const c = await categoria("subscripcions", { isRecurrent: true, isSubscription: true });
    const netflix = await comerc("NETFLIX");
    const spotify = await comerc("SPOTIFY");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", c, netflix);
      await moviment(`s${i}`, addDays(avui, -dies), "-10.99", c, spotify);
    }

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(2);
    expect(await llistaSeries(ledgerId, false, true)).toHaveLength(2);
  });
});

describe("tornar a detectar", () => {
  test("actualitza la serie en lloc de duplicar-la", async () => {
    const c = await categoria("subscripcions", { isRecurrent: true });
    const m = await comerc("SPOTIFY");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`p${i}`, addDays(avui, -dies), "-10.99", c, m);
    }

    await detectaRecurrents(ledgerId);
    const segona = await detectaRecurrents(ledgerId);

    expect(segona.creades).toBe(0);
    expect(segona.actualitzades).toBe(1);
    expect(await llistaSeries(ledgerId, false, true)).toHaveLength(1);
  });

  test("avisa quan l'import s'aparta del que era habitual", async () => {
    const c = await categoria("recurrent-auto", { isRecurrent: true });
    const m = await comerc("GIMNAS");
    const avui = todayLocal();
    for (const [i, dies] of [120, 90, 60].entries()) {
      await moviment(`g${i}`, addDays(avui, -dies), "-30.00", c, m);
    }
    await detectaRecurrents(ledgerId);

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

describe("el resum de subscripcions", () => {
  test("suma nomes les subscripcions actives que treuen diners", async () => {
    const avui = todayLocal();
    const subscripcions = await categoria("subscripcions", {
      isRecurrent: true,
      isSubscription: true,
    });
    const nomina = await categoria("nomina", { isRecurrent: true, kind: "income" });
    const netflix = await comerc("NETFLIX");
    const feina = await comerc("EMPRESA");
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-10.00", subscripcions, netflix);
      await moviment(`s${i}`, addDays(avui, -dies), "2000.00", nomina, feina);
    }
    await detectaRecurrents(ledgerId);

    const resum = await resumSubscripcions(ledgerId);
    // 10 EUR al mes repartits sobre un interval de 30 dies.
    expect(Number(resum.mensual)).toBeCloseTo(10, 1);
    expect(Number(resum.anual)).toBeCloseTo(120, 1);
  });

  test("una serie acabada deixa de comptar", async () => {
    const c = await categoria("subscripcions", { isRecurrent: true, isSubscription: true });
    const netflix = await comerc("NETFLIX");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-10.00", c, netflix);
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
    const c = await categoria("recurrent-auto", { isRecurrent: true });
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

describe("categories declarades com a recurrents", () => {
  test("una sola aparicio ja crea serie si la categoria porta cadencia declarada", async () => {
    const c = await categoria("asseguranca", { isRecurrent: true, cadence: "annual" });
    const m = await comerc("ASSEGURANCA");
    await moviment("a1", addDays(todayLocal(), -200), "-450.00", c, m);

    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const series = await llistaSeries(ledgerId, false, false);
    expect(series).toHaveLength(1);
    expect(series[0]?.cadence).toBe("annual");
    expect(series[0]?.intervalDays).toBe(365);
    expect(series[0]?.isDeclared).toBe(true);
    expect(series[0]?.includeInForecast).toBe(true);
  });

  test("el detector no sobreescriu la cadencia declarada", async () => {
    const c = await categoria("lloguer", { isRecurrent: true, cadence: "quarterly" });
    const m = await comerc("LLOGUER");
    const avui = todayLocal();
    // Intervals que el detector interpretaria com a mensuals si no hi hagues
    // cadencia declarada.
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`ll${i}`, addDays(avui, -dies), "-800.00", c, m);
    }

    await detectaRecurrents(ledgerId);

    const [serie] = await llistaSeries(ledgerId, false, false);
    expect(serie?.cadence).toBe("quarterly");
    expect(serie?.intervalDays).toBe(91);
  });

  test("desmarcar la categoria esborra la serie; tornar-la a marcar la deixa refer des de zero", async () => {
    const c = await categoria("neteja", { isRecurrent: true });
    const m = await comerc("NETEJA");
    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-40.00", c, m);
    }
    await detectaRecurrents(ledgerId);
    expect(await llistaSeries(ledgerId, false, true)).toHaveLength(1);

    await marcaRecurrent(c, ledgerId, { isRecurrent: false, cadence: null });
    const [buida] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    expect(buida).toBeUndefined();

    await marcaRecurrent(c, ledgerId, { isRecurrent: true, cadence: null });
    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(1);

    const [refeta] = await llistaSeries(ledgerId, false, false);
    expect(refeta?.status).toBe("active");
    expect(refeta?.isDeclared).toBe(false);
  });

  test("comprovaRebutsQueFalten no acaba una serie d'una categoria declarada", async () => {
    const c = await categoria("gimnas", { isRecurrent: true, cadence: "monthly" });
    const m = await comerc("GIMNAS DECLARAT");
    await moviment("g1", addDays(todayLocal(), -120), "-35.00", c, m);
    await detectaRecurrents(ledgerId);

    await db
      .update(recurringSeries)
      .set({ nextExpectedDate: addDays(todayLocal(), -50), intervalDays: 30 })
      .where(eq(recurringSeries.ledgerId, ledgerId));

    await comprovaRebutsQueFalten(ledgerId);

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    expect(serie?.status).toBe("active");
  });
});
