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
import { checkOverdrafts, buildForecast, eventsExpected } from "../src/services/forecast.ts";
import { confirmSeries, detectRecurring } from "../src/services/recurring.ts";
import { incomeAndExpenses, monthlySeries } from "../src/services/reports.ts";
import { seedCategories } from "../src/services/seed.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";
import { money } from "../src/lib/money.ts";

let workspace: Ledger;
let accountId = 0;

async function transaction(
  key: string,
  date: string,
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
      ledgerId: workspace.id,
      dedupKey: key,
      source: "manual",
      bookingDate: date,
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
async function activeSeries(opts: {
  amount: string;
  intervalDays: number;
  nextExpectedDate: string;
  label?: string;
  categoryId: number;
  merchantId?: number | null;
}) {
  const [series] = await db
    .insert(recurringSeries)
    .values({
      ledgerId: workspace.id,
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
  return series;
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
  workspace = creat as Ledger;
  await seedCategories(workspace.id);

  const [connection] = await db
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
  const [account] = await db
    .insert(accounts)
    .values({
      connectionId: connection?.id ?? 0,
      ledgerId: workspace.id,
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
  accountId = account?.id ?? 0;

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
      await transaction(`d${i}`, addDays(todayLocal(), -i * 10), "-100.00");
    }

    const forecast = await buildForecast(workspace, 30);
    expect(forecast.points).toHaveLength(31);
    expect(Number(forecast.points[0]?.esperat)).toBeCloseTo(1000, 1);
    expect(Number(forecast.points[30]?.esperat)).toBeCloseTo(1000, 1);
    expect(forecast.despesaDiaria).toBe("0.00");
    expect(forecast.firstOverdraft).toBeNull();
    // Mateixa amplada a esquerra (real) i dreta (previsio), amb avui a les dues.
    expect(forecast.historic.length).toBe(31);
    expect(forecast.historic[forecast.historic.length - 1]?.day).toBe(todayLocal());
    expect(Number(forecast.historic[forecast.historic.length - 1]?.balance)).toBeCloseTo(
      1000,
      1,
    );
  });

  test("sense despesa residual, les bandes coincideixen amb l'esperat", async () => {
    const forecast = await buildForecast(workspace, 30);
    const last = forecast.points[30];

    expect(last?.optimista).toBe(last?.esperat);
    expect(last?.pessimista).toBe(last?.esperat);
  });

  test("una serie suggested no baixa el saldo; confirmada si", async () => {
    const [merchant] = await db
      .insert(merchants)
      .values({
        ledgerId: workspace.id,
        normalizedName: "NETFLIX",
        displayName: "Netflix",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 3,
        lastSeenAt: addDays(todayLocal(), -30),
      })
      .returning();

    const [category] = await db
      .insert(categories)
      .values({
        ledgerId: workspace.id,
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

    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", {
        categoryId: category?.id ?? 0,
        merchantId: merchant?.id ?? 0,
      });
    }

    await detectRecurring(workspace.id);

    const unconfirmed = await buildForecast(workspace, 40);
    expect(Number(unconfirmed.points[40]?.esperat)).toBeCloseTo(1000, 1);

    const [proposal] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, workspace.id));
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("calia una proposta");
    await confirmSeries(proposal.id, { cadence: "monthly", amountMode: "exact" });

    const withConfirm = await buildForecast(workspace, 40);
    expect(money(withConfirm.points[40]?.esperat).lt(money("1000"))).toBe(true);
  });

  test("una serie activa anual apareix als esdeveniments previstos", async () => {
    const [category] = await db
      .insert(categories)
      .values({
        ledgerId: workspace.id,
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

    await activeSeries({
      amount: "-450.00",
      intervalDays: 365,
      nextExpectedDate: addDays(todayLocal(), 20),
      label: "Assegurança casa",
      categoryId: category?.id ?? 0,
    });

    const horitzo = addDays(todayLocal(), 400);
    const events = await eventsExpected(workspace.id, horitzo);
    expect(events.some((e) => e.amount === "-450.00")).toBe(true);

    const forecast = await buildForecast(workspace, 400);
    const withBill = forecast.points.find((p) =>
      money(p.esperat).lt(money(forecast.points[0]?.esperat ?? "0")),
    );
    expect(withBill).toBeDefined();
  });
});

describe("l'avis de descobert", () => {
  test("salta quan un schedule confirmat creua el llindar", async () => {
    const [category] = await db
      .insert(categories)
      .values({
        ledgerId: workspace.id,
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
    await activeSeries({
      amount: "-200.00",
      intervalDays: 5,
      nextExpectedDate: addDays(todayLocal(), 1),
      label: "Lloguer",
      categoryId: category?.id ?? 0,
    });

    const forecast = await buildForecast(workspace, 60);
    expect(forecast.firstOverdraft).not.toBeNull();

    const created = await checkOverdrafts(workspace, 60);
    expect(created).toBe(1);

    const [alert] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.type, "projected_overdraft"));
    expect(alert?.title).toContain("possible descobert");
    expect(alert?.ledgerId).toBe(workspace.id);
  });

  test("no es repeteix dins de la mateixa setmana", async () => {
    const [category] = await db
      .insert(categories)
      .values({
        ledgerId: workspace.id,
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

    await activeSeries({
      amount: "-200.00",
      intervalDays: 5,
      nextExpectedDate: addDays(todayLocal(), 1),
      label: "Lloguer",
      categoryId: category?.id ?? 0,
    });

    await checkOverdrafts(workspace, 60);
    const segon = await checkOverdrafts(workspace, 60);
    expect(segon).toBe(0);
  });

  test("no salta si el saldo aguanta", async () => {
    expect(await checkOverdrafts(workspace, 60)).toBe(0);
  });
});

describe("els agregats dels informes", () => {
  test("els traspassos i els exclosos no son ni ingres ni despesa", async () => {
    const today = todayLocal();
    await transaction("normal", today, "-50.00");
    await transaction("traspas", today, "-500.00", { transferGroupId: "g1" });
    await transaction("exclos", today, "-500.00", { isExcluded: true });
    await transaction("pendent", today, "-500.00", { status: "pending" });

    const totals = await incomeAndExpenses([workspace.id], null, null);
    expect(Number(totals.expenses)).toBe(50);
  });

  test("la serie mensual separa els mesos", async () => {
    await transaction("a", "2026-01-15", "-100.00");
    await transaction("b", "2026-02-10", "-200.00");
    await transaction("c", "2026-02-20", "300.00");

    const series = await monthlySeries([workspace.id], "2026-01-01", "2026-03-01");
    expect(series).toHaveLength(2);
    expect(series[0]?.periode).toBe("2026-01");
    expect(Number(series[0]?.expenses)).toBe(100);
    expect(Number(series[0]?.despesesVariables)).toBe(100);
    expect(Number(series[0]?.despesesFixes)).toBe(0);
    expect(series[1]?.periode).toBe("2026-02");
    expect(Number(series[1]?.expenses)).toBe(200);
    expect(Number(series[1]?.income)).toBe(300);
    expect(Number(series[1]?.cleaned)).toBe(100);
  });

  test("la serie mensual separa despeses fixes i variables", async () => {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.ledgerId, workspace.id))
      .limit(1);
    const categoryId = category?.id ?? 0;

    const fixedId = await transaction("fixa", "2026-03-05", "-80.00", { categoryId });
    await transaction("variable", "2026-03-12", "-40.00");

    const series = await activeSeries({
      amount: "-80.00",
      intervalDays: 30,
      nextExpectedDate: addDays(todayLocal(), 20),
      categoryId,
      label: "Lloguer",
    });
    expect(series).toBeDefined();
    await db.insert(recurringOccurrences).values({
      seriesId: series?.id ?? 0,
      transactionId: fixedId,
      occurredOn: "2026-03-05",
      amount: "-80.00",
    });

    const points = await monthlySeries([workspace.id], "2026-03-01", "2026-04-01");
    expect(points).toHaveLength(1);
    expect(Number(points[0]?.expenses)).toBe(120);
    expect(Number(points[0]?.despesesFixes)).toBe(80);
    expect(Number(points[0]?.despesesVariables)).toBe(40);
  });
});
