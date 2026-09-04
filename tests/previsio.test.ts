/**
 * Previsio de saldo i avis de descobert.
 *
 * Traduccio de la part de `backend/tests/test_recurring_forecast.py` que mira
 * la projeccio.
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
  despesaDiariaVariable,
} from "../src/services/forecast.ts";
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
      merchantId: null,
      categoryId: null,
      categorySource: "none",
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

describe("la despesa variable", () => {
  test("es la mitjana diaria de la finestra, no dels dies amb moviment", async () => {
    // 900 EUR repartits en 9 despeses dins dels ultims 90 dies.
    for (let i = 0; i < 9; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i * 10), "-100.00");
    }
    const diaria = await despesaDiariaVariable(espai.id);
    // 900 / 90 dies = 10 EUR al dia.
    expect(Number(diaria)).toBeCloseTo(10, 1);
  });

  test("els traspassos i els exclosos no hi compten", async () => {
    await moviment("t", addDays(todayLocal(), -5), "-900.00", { transferGroupId: "g" });
    await moviment("x", addDays(todayLocal(), -5), "-900.00", { isExcluded: true });
    expect(Number(await despesaDiariaVariable(espai.id))).toBe(0);
  });

  test("els ingressos tampoc", async () => {
    await moviment("i", addDays(todayLocal(), -5), "2000.00");
    expect(Number(await despesaDiariaVariable(espai.id))).toBe(0);
  });
});

describe("la projeccio", () => {
  test("comença al saldo d'avui i baixa amb la despesa variable", async () => {
    for (let i = 0; i < 9; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i * 10), "-100.00");
    }

    const previsio = await construeixPrevisio(espai, 30);
    expect(previsio.punts).toHaveLength(31);
    expect(Number(previsio.punts[0]?.esperat)).toBeCloseTo(1000, 1);
    // 30 dies × 10 EUR = 300 EUR menys.
    expect(Number(previsio.punts[30]?.esperat)).toBeCloseTo(700, 1);
  });

  test("l'optimista va per sobre i la pessimista per sota", async () => {
    for (let i = 0; i < 9; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i * 10), "-100.00");
    }
    const previsio = await construeixPrevisio(espai, 30);
    const ultim = previsio.punts[30];

    expect(money(ultim?.optimista).gt(money(ultim?.esperat))).toBe(true);
    expect(money(ultim?.pessimista).lt(money(ultim?.esperat))).toBe(true);
  });

  test("sense despeses, la linia es plana", async () => {
    const previsio = await construeixPrevisio(espai, 30);
    expect(Number(previsio.punts[0]?.esperat)).toBeCloseTo(1000, 1);
    expect(Number(previsio.punts[30]?.esperat)).toBeCloseTo(1000, 1);
    expect(previsio.primerDescobert).toBeNull();
  });
});

describe("l'avis de descobert", () => {
  test("salta quan la projeccio creua el llindar", async () => {
    // 100 EUR al dia: en 10 dies s'acaben els 1000.
    for (let i = 0; i < 90; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i), "-100.00");
    }

    const previsio = await construeixPrevisio(espai, 60);
    expect(previsio.primerDescobert).not.toBeNull();

    const creats = await comprovaDescoberts(espai, 60);
    expect(creats).toBe(1);

    const [avis] = await db.select().from(alerts).where(eq(alerts.type, "projected_overdraft"));
    expect(avis?.title).toContain("possible descobert");
    expect(avis?.ledgerId).toBe(espai.id);
  });

  test("no es repeteix dins de la mateixa setmana", async () => {
    for (let i = 0; i < 90; i += 1) {
      await moviment(`d${i}`, addDays(todayLocal(), -i), "-100.00");
    }
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
    expect(serie[1]?.periode).toBe("2026-02");
    expect(Number(serie[1]?.despeses)).toBe(200);
    expect(Number(serie[1]?.ingressos)).toBe(300);
    expect(Number(serie[1]?.net)).toBe(100);
  });
});
