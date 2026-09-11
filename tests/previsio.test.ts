/**
 * Previsio de saldo i avis de descobert.
 *
 * La previsio nomes mira schedules `active` amb `include_in_forecast`.
 * No hi ha «despesa variable» residual.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  alerts,
  balances,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  type Ledger,
} from "../src/db/schema/index.ts";
import {
  comprovaDescoberts,
  construeixPrevisio,
  esdevenimentsPrevistos,
} from "../src/services/forecast.ts";
import { confirmaSerie, detectaRecurrents } from "../src/services/recurring.ts";
import { ingressosIDespeses, serieMensual } from "../src/services/reports.ts";
import { seedCategories } from "../src/services/seed.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";
import { money } from "../src/lib/money.ts";

let espai: Ledger;
let accountId = 0;

async function moviment(
  clau: string,
  data: string,
  quantitat: string,
  extra: Partial<{
    transferGroupId: string;
    isExcluded: boolean;
    status: "booked" | "pending";
    categoryId: number | null;
    merchantId: number | null;
  }> = {},
) {
  const [t] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId: espai.id,
      dedupKey: clau,
      source: "manual",
      bookingDate: data,
      amount: quantitat,
      currency: "EUR",
      status: extra.status ?? "booked",
      description: "M",
      normalizedDescription: "M",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: extra.merchantId ?? null,
      categoryId: extra.categoryId ?? null,
      categorySource: extra.categoryId ? "user" : "none",
      needsReview: false,
      transferGroupId: extra.transferGroupId ?? null,
      notes: "",
      tags: [],
      isExcluded: extra.isExcluded ?? false,
      raw: {},
    })
    .returning();
  return t?.id ?? 0;
}

/** Una serie activa a la previsio, sense passar pel detector. */
async function serieActiva(opts: {
  amount: string;
  intervalDays: number;
  nextExpectedDate: string;
  label?: string;
  categoryId: number;
  merchantId?: number | null;
}) {
  const [serie] = await db
    .insert(recurringSeries)
    .values({
      ledgerId: espai.id,
      signature: `c${opts.categoryId}|m${opts.merchantId ?? "-"}|out-test-${opts.label ?? opts.amount}`,
      label: opts.label ?? "Rebut previst",
      merchantId: opts.merchantId ?? null,
      categoryId: opts.categoryId,
      cadence: "monthly",
      expectedAmount: opts.amount,
      amountTolerance: "5.00",
      amountMode: "exact",
      intervalDays: opts.intervalDays,
      confidence: 1,
      occurrencesCount: 3,
      firstSeenDate: addDays(todayLocal(), -90),
      lastSeenDate: addDays(todayLocal(), -30),
      nextExpectedDate: opts.nextExpectedDate,
      status: "active",
      includeInForecast: true,
    })
    .returning();
  return serie;
}

beforeEach(async () => {
  await db.delete(recurringOccurrences);
  await db.delete(recurringSeries);
  await db.delete(transactions);
  await db.delete(alerts);
  await db.delete(balances);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(ledgers);

  const [creat] = await db
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
  espai = creat as Ledger;
  await seedCategories(espai.id);

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
      ledgerId: espai.id,
      ebAccountUid: "uid-f",
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

  // Saldo conegut d'avui.
  await db.insert(balances).values({
    accountId,
    balanceType: "CLBD",
    amount: "1000.00",
    currency: "EUR",
    referenceDate: todayLocal(),
    fetchedAt: new Date(),
  });
});

describe("la projeccio", () => {
  test("sense schedules, la linia es plana al saldo d'avui", async () => {
    for (let i = 0; i < 9; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i * 10), "-100.00");
    }

    const previsio = await construeixPrevisio(espai, 30);
    expect(previsio.punts).toHaveLength(31);
    expect(Number(previsio.punts[0]?.esperat)).toBeCloseTo(1000, 1);
    expect(Number(previsio.punts[30]?.esperat)).toBeCloseTo(1000, 1);
    expect(previsio.despesaDiaria).toBe("0.00");
    expect(previsio.primerDescobert).toBeNull();
    // Mateixa amplada a esquerra (real) i dreta (previsio), amb avui a les dues.
    expect(previsio.historic.length).toBe(31);
    expect(previsio.historic[previsio.historic.length - 1]?.dia).toBe(todayLocal());
    expect(Number(previsio.historic[previsio.historic.length - 1]?.saldo)).toBeCloseTo(1000, 1);
  });

  test("sense despesa residual, les bandes coincideixen amb l'esperat", async () => {
    const previsio = await construeixPrevisio(espai, 30);
    const ultim = previsio.punts[30];

    expect(ultim?.optimista).toBe(ultim?.esperat);
    expect(ultim?.pessimista).toBe(ultim?.esperat);
  });

  test("una serie suggested no baixa el saldo; confirmada si", async () => {
    const [comerc] = await db
      .insert(merchants)
      .values({
        ledgerId: espai.id,
        normalizedName: "NETFLIX",
        displayName: "Netflix",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 3,
        lastSeenAt: addDays(todayLocal(), -30),
      })
      .returning();

    const [categoria] = await db
      .insert(categories)
      .values({
        ledgerId: espai.id,
        parentId: null,
        slug: "subscripcions-test",
        name: "Subscripcions",
        kind: "expense",
        color: "#000000",
        icon: "",
        isSystem: false,
        position: 0,
      })
      .returning();

    const avui = todayLocal();
    for (const [i, dies] of [90, 60, 30].entries()) {
      await moviment(`n${i}`, addDays(avui, -dies), "-12.99", {
        categoryId: categoria?.id ?? 0,
        merchantId: comerc?.id ?? 0,
      });
    }

    await detectaRecurrents(espai.id);

    const senseConfirmar = await construeixPrevisio(espai, 40);
    expect(Number(senseConfirmar.punts[40]?.esperat)).toBeCloseTo(1000, 1);

    const [proposta] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, espai.id));
    expect(proposta).toBeDefined();
    if (!proposta) throw new Error("calia una proposta");
    await confirmaSerie(proposta.id, { cadence: "monthly", amountMode: "exact" });

    const ambConfirmar = await construeixPrevisio(espai, 40);
    expect(money(ambConfirmar.punts[40]?.esperat).lt(money("1000"))).toBe(true);
  });

  test("una serie activa anual apareix als esdeveniments previstos", async () => {
    const [categoria] = await db
      .insert(categories)
      .values({
        ledgerId: espai.id,
        parentId: null,
        slug: "asseguranca-anual",
        name: "Assegurança anual",
        kind: "expense",
        color: "#000000",
        icon: "",
        isSystem: false,
        position: 0,
      })
      .returning();

    await serieActiva({
      amount: "-450.00",
      intervalDays: 365,
      nextExpectedDate: addDays(todayLocal(), 20),
      label: "Assegurança casa",
      categoryId: categoria?.id ?? 0,
    });

    const horitzo = addDays(todayLocal(), 400);
    const esdeveniments = await esdevenimentsPrevistos(espai.id, horitzo);
    expect(esdeveniments.some((e) => e.amount === "-450.00")).toBe(true);

    const previsio = await construeixPrevisio(espai, 400);
    const ambRebut = previsio.punts.find((p) =>
      money(p.esperat).lt(money(previsio.punts[0]?.esperat ?? "0")),
    );
    expect(ambRebut).toBeDefined();
  });
});

describe("l'avis de descobert", () => {
  test("salta quan un schedule confirmat creua el llindar", async () => {
    const [categoria] = await db
      .insert(categories)
      .values({
        ledgerId: espai.id,
        parentId: null,
        slug: "lloguer-gran",
        name: "Lloguer",
        kind: "expense",
        color: "#000000",
        icon: "",
        isSystem: false,
        position: 0,
      })
      .returning();

    // 200 EUR cada 5 dies: en menys de 60 dies s'acaben els 1000.
    await serieActiva({
      amount: "-200.00",
      intervalDays: 5,
      nextExpectedDate: addDays(todayLocal(), 1),
      label: "Lloguer",
      categoryId: categoria?.id ?? 0,
    });

    const previsio = await construeixPrevisio(espai, 60);
    expect(previsio.primerDescobert).not.toBeNull();

    const creats = await comprovaDescoberts(espai, 60);
    expect(creats).toBe(1);

    const [avis] = await db.select().from(alerts).where(eq(alerts.type, "projected_overdraft"));
    expect(avis?.title).toContain("possible descobert");
    expect(avis?.ledgerId).toBe(espai.id);
  });

  test("no es repeteix dins de la mateixa setmana", async () => {
    const [categoria] = await db
      .insert(categories)
      .values({
        ledgerId: espai.id,
        parentId: null,
        slug: "lloguer-gran-2",
        name: "Lloguer",
        kind: "expense",
        color: "#000000",
        icon: "",
        isSystem: false,
        position: 0,
      })
      .returning();

    await serieActiva({
      amount: "-200.00",
      intervalDays: 5,
      nextExpectedDate: addDays(todayLocal(), 1),
      label: "Lloguer",
      categoryId: categoria?.id ?? 0,
    });

    await comprovaDescoberts(espai, 60);
    const segon = await comprovaDescoberts(espai, 60);
    expect(segon).toBe(0);
  });

  test("no salta si el saldo aguanta", async () => {
    expect(await comprovaDescoberts(espai, 60)).toBe(0);
  });
});

describe("els agregats dels informes", () => {
  test("els traspassos i els exclosos no son ni ingres ni despesa", async () => {
    const avui = todayLocal();
    await moviment("normal", avui, "-50.00");
    await moviment("traspas", avui, "-500.00", { transferGroupId: "g1" });
    await moviment("exclos", avui, "-500.00", { isExcluded: true });
    await moviment("pendent", avui, "-500.00", { status: "pending" });

    const totals = await ingressosIDespeses([espai.id], null, null);
    expect(Number(totals.despeses)).toBe(50);
  });

  test("la serie mensual separa els mesos", async () => {
    await moviment("a", "2026-01-15", "-100.00");
    await moviment("b", "2026-02-10", "-200.00");
    await moviment("c", "2026-02-20", "300.00");

    const serie = await serieMensual([espai.id], "2026-01-01", "2026-03-01");
    expect(serie).toHaveLength(2);
    expect(serie[0]?.periode).toBe("2026-01");
    expect(Number(serie[0]?.despeses)).toBe(100);
    expect(Number(serie[0]?.despesesVariables)).toBe(100);
    expect(Number(serie[0]?.despesesFixes)).toBe(0);
    expect(serie[1]?.periode).toBe("2026-02");
    expect(Number(serie[1]?.despeses)).toBe(200);
    expect(Number(serie[1]?.ingressos)).toBe(300);
    expect(Number(serie[1]?.net)).toBe(100);
  });

  test("la serie mensual separa despeses fixes i variables", async () => {
    const [categoria] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.ledgerId, espai.id))
      .limit(1);
    const categoryId = categoria?.id ?? 0;

    const fixaId = await moviment("fixa", "2026-03-05", "-80.00", { categoryId });
    await moviment("variable", "2026-03-12", "-40.00");

    const serie = await serieActiva({
      amount: "-80.00",
      intervalDays: 30,
      nextExpectedDate: addDays(todayLocal(), 20),
      categoryId,
      label: "Lloguer",
    });
    expect(serie).toBeDefined();
    await db.insert(recurringOccurrences).values({
      seriesId: serie?.id ?? 0,
      transactionId: fixaId,
      occurredOn: "2026-03-05",
      amount: "-80.00",
    });

    const punts = await serieMensual([espai.id], "2026-03-01", "2026-04-01");
    expect(punts).toHaveLength(1);
    expect(Number(punts[0]?.despeses)).toBe(120);
    expect(Number(punts[0]?.despesesFixes)).toBe(80);
    expect(Number(punts[0]?.despesesVariables)).toBe(40);
  });
});
