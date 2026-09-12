/**
 * Detection of recurring series (schedules).
 *
 * The detector looks at the categorized history and **only proposes** series
 * (`status: suggested`, out of the forecast). It needs ≥3 occurrences at
 * regular intervals; there is no category gate and no subscription flag. The
 * person confirms (`confirmSeries` → `active`) or dismisses at `/recurrents`.
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
  updateSeriesAmount,
  checkMissingBills,
  confirmSeries,
  createSeriesManual,
  dismissSeries,
  detectRecurring,
} from "../src/services/recurring.ts";
import { seriesOccurrences, listSeries } from "../src/services/recurring-list.ts";
import { listTransactions } from "../src/services/transactions.ts";
import { ConflictError } from "../src/lib/http.ts";
import { seedCategories } from "../src/services/seed.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";

let ledgerId = 0;
let accountId = 0;

/** Inserts a transaction with a given category (and, optionally, a merchant). */
async function transaction(
  key: string,
  date: string,
  quantitat: string,
  categoryId: number | null,
  merchantId: number | null = null,
  extra: Partial<{ transferGroupId: string; isExcluded: boolean }> = {},
) {
  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey: key,
    source: "manual",
    bookingDate: date,
    amount: quantitat,
    currency: "EUR",
    status: "booked",
    description: "Rebut",
    normalizedDescription: "REBUT GENERIC",
    counterparty: "",
    bankTransactionCode: "",
    merchantId: merchantId,
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

async function merchant(name: string): Promise<number> {
  const [m] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: name,
      displayName: name,
      defaultCategoryId: null,
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      lastSeenAt: null,
    })
    .returning();
  return m?.id ?? 0;
}

async function category(slug: string, opts: { kind?: CategoryKind } = {}): Promise<number> {
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
  accountId = account?.id ?? 0;
});

describe("cal categoritzar", () => {
  test("un moviment sense categoria no genera res encara que la resta ho siguin", async () => {
    const c = await category("subscripcions");
    const m = await merchant("NETFLIX");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", i === 0 ? null : c, m);
    }

    // Only two of the three have a category: it does not reach the minimum number of occurrences.
    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("el mateix comerç amb dues categories fa series separades", async () => {
    const lloguer = await category("lloguer");
    const sopars = await category("sopars-ocasionals");
    const m = await merchant("MARIA GARCIA");
    const today = todayLocal();

    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`ll${i}`, addDays(today, -days), "-350.00", lloguer, m);
    }
    // A single dinner: it does not reach 3 occurrences.
    await transaction("sopar", addDays(today, -5), "-42.50", sopars, m);

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(1);

    const series = await listSeries(ledgerId);
    expect(series).toHaveLength(1);
    expect(series[0]?.categoryId).toBe(lloguer);
    expect(series[0]?.status).toBe("suggested");
    expect(series[0]?.includeInForecast).toBe(false);
  });
});

describe("que es reconeix com a serie", () => {
  test("tres rebuts mensuals iguals creen una proposta suggested", async () => {
    const c = await category("subscripcions");
    const netflix = await merchant("NETFLIX");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", c, netflix);
    }

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(1);

    const [series] = await listSeries(ledgerId);
    expect(series?.cadence).toBe("monthly");
    expect(series?.expectedAmount).toBe("-12.99");
    expect(series?.status).toBe("suggested");
    expect(series?.includeInForecast).toBe(false);
  });

  test("confirmaSerie la passa a active i a la previsio", async () => {
    const c = await category("subscripcions");
    const netflix = await merchant("NETFLIX");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", c, netflix);
    }
    await detectRecurring(ledgerId);
    const proposal = (await listSeries(ledgerId, { statuses: ["suggested"] }))[0];
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("calia una proposta");

    await confirmSeries(proposal.id, { cadence: "monthly", amountMode: "exact" });

    const [active] = await listSeries(ledgerId, { statuses: ["active"] });
    expect(active?.status).toBe("active");
    expect(active?.includeInForecast).toBe(true);
    expect(active?.cadence).toBe("monthly");
  });

  test("nomes dues aparicions, no", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("NOMES DUES");
    const today = todayLocal();
    await transaction("a", addDays(today, -60), "-10.00", c, m);
    await transaction("b", addDays(today, -30), "-10.00", c, m);

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("tres aparicions a intervals irregulars, no", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("IRREGULAR");
    const today = todayLocal();
    await transaction("a", addDays(today, -100), "-10.00", c, m);
    await transaction("b", addDays(today, -43), "-10.00", c, m);
    await transaction("c", addDays(today, -2), "-10.00", c, m);

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("un ingres regular tambe es una serie", async () => {
    const c = await category("nomina", { kind: "income" });
    const job = await merchant("EMPRESA");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`s${i}`, addDays(today, -days), "1800.00", c, job);
    }

    await detectRecurring(ledgerId);
    const [series] = await listSeries(ledgerId);
    expect(series?.status).toBe("suggested");
    expect(series?.expectedAmount).toBe("1800.00");
  });

  test("els traspassos entre comptes propis no compten", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("TRASPAS");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`t${i}`, addDays(today, -days), "-50.00", c, m, {
        transferGroupId: "g1",
      });
    }

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("els moviments exclosos tampoc", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("EXCLOS");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`e${i}`, addDays(today, -days), "-50.00", c, m, { isExcluded: true });
    }

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(0);
  });

  test("dos comerços a la mateixa categoria fan series separades", async () => {
    const c = await category("subscripcions");
    const netflix = await merchant("NETFLIX");
    const spotify = await merchant("SPOTIFY");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", c, netflix);
      await transaction(`s${i}`, addDays(today, -days), "-10.99", c, spotify);
    }

    const stats = await detectRecurring(ledgerId);
    expect(stats.creades).toBe(2);
    expect(await listSeries(ledgerId)).toHaveLength(2);
  });
});

describe("tornar a detectar", () => {
  test("actualitza la serie suggested en lloc de duplicar-la", async () => {
    const c = await category("subscripcions");
    const m = await merchant("SPOTIFY");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`p${i}`, addDays(today, -days), "-10.99", c, m);
    }

    await detectRecurring(ledgerId);
    const segona = await detectRecurring(ledgerId);

    expect(segona.creades).toBe(0);
    expect(segona.actualitzades).toBe(1);
    expect(await listSeries(ledgerId)).toHaveLength(1);
  });

  test("avisa quan l'import d'una serie active exact s'aparta", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("GIMNAS");
    const today = todayLocal();
    for (const [i, days] of [120, 90, 60].entries()) {
      await transaction(`g${i}`, addDays(today, -days), "-30.00", c, m);
    }
    await detectRecurring(ledgerId);
    const proposal = (await listSeries(ledgerId, { statuses: ["suggested"] }))[0];
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("calia una proposta");
    await confirmSeries(proposal.id, { cadence: "monthly", amountMode: "exact" });

    // A direct debit much dearer than the others.
    await transaction("g-car", addDays(today, -30), "-45.00", c, m);
    const stats = await detectRecurring(ledgerId);

    expect(stats.alertList).toBe(1);
    const [alert] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.type, "recurring_amount_change"));
    expect(alert?.title).toContain("puja");
  });
});

describe("les aparicions", () => {
  test("queden enllaçades amb la serie i no es dupliquen", async () => {
    const c = await category("recurrent-auto");
    const m = await merchant("LLUM");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`l${i}`, addDays(today, -days), "-55.00", c, m);
    }

    await detectRecurring(ledgerId);
    await detectRecurring(ledgerId);

    const [series] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    const occurrences = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.seriesId, series?.id ?? 0));
    expect(occurrences).toHaveLength(3);
  });
});

describe("rebuts que falten", () => {
  test("comprovaRebutsQueFalten avisa d'una serie active exact retardada", async () => {
    const c = await category("gimnas");
    const m = await merchant("GIMNAS");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`g${i}`, addDays(today, -days), "-35.00", c, m);
    }
    await detectRecurring(ledgerId);
    const proposal = (await listSeries(ledgerId, { statuses: ["suggested"] }))[0];
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("calia una proposta");
    await confirmSeries(proposal.id, { cadence: "monthly", amountMode: "exact" });

    await db
      .update(recurringSeries)
      .set({ nextExpectedDate: addDays(today, -10), intervalDays: 30 })
      .where(eq(recurringSeries.ledgerId, ledgerId));

    const alertList = await checkMissingBills(ledgerId);
    expect(alertList).toBe(1);

    const [series] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    // Confirmed exact ones stay active; they only warn.
    expect(series?.status).toBe("active");
  });
});

describe("CRUD manual", () => {
  test("creaSerieManual fa una serie active a la previsio", async () => {
    const c = await category("lloguer");
    const id = await createSeriesManual(ledgerId, {
      label: "Lloguer pis",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-850.00",
      nextExpectedDate: addDays(todayLocal(), 5),
    });

    const [series] = await listSeries(ledgerId, { statuses: ["active"] });
    expect(series?.id).toBe(id);
    expect(series?.label).toBe("Lloguer pis");
    expect(series?.expectedAmount).toBe("-850.00");
    expect(series?.includeInForecast).toBe(true);
    expect(series?.amountMode).toBe("exact");
  });

  test("reviu una serie descartada amb la mateixa signatura", async () => {
    const c = await category("lloguer");
    const id = await createSeriesManual(ledgerId, {
      label: "Lloguer",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-800.00",
      nextExpectedDate: todayLocal(),
    });
    await dismissSeries(id);

    const revifada = await createSeriesManual(ledgerId, {
      label: "Lloguer nou",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-900.00",
      nextExpectedDate: addDays(todayLocal(), 10),
    });
    expect(revifada).toBe(id);

    const [series] = await listSeries(ledgerId, { statuses: ["active"] });
    expect(series?.label).toBe("Lloguer nou");
    expect(series?.expectedAmount).toBe("-900.00");
    expect(series?.status).toBe("active");
  });

  test("conflicto si ja n'hi ha una d'activa", async () => {
    const c = await category("lloguer");
    await createSeriesManual(ledgerId, {
      label: "Lloguer",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-800.00",
      nextExpectedDate: todayLocal(),
    });

    await expect(
      createSeriesManual(ledgerId, {
        label: "Un altre",
        categoryId: c,
        cadence: "monthly",
        expectedAmount: "-700.00",
        nextExpectedDate: todayLocal(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("actualitzaImportSerie deixa l'import fix", async () => {
    const c = await category("subscripcions");
    const id = await createSeriesManual(ledgerId, {
      label: "Netflix",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-12.99",
      nextExpectedDate: todayLocal(),
    });

    await updateSeriesAmount(id, "-15.00");
    const [series] = await listSeries(ledgerId, { statuses: ["active"] });
    expect(series?.expectedAmount).toBe("-15.00");
    expect(series?.amountMode).toBe("exact");
  });

  test("descartaSerie treu una activa de la llista", async () => {
    const c = await category("lloguer");
    const id = await createSeriesManual(ledgerId, {
      label: "Lloguer",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-800.00",
      nextExpectedDate: todayLocal(),
    });
    await dismissSeries(id);
    expect(await listSeries(ledgerId, { statuses: ["active"] })).toHaveLength(0);
  });
});

describe("moviments i recurrents", () => {
  const baseFilter = {
    accountId: null as number | null,
    dateFrom: null as string | null,
    dateTo: null as string | null,
    categoryIds: [] as number[],
    merchantId: null as number | null,
    search: "",
    tag: null as string | null,
    operationType: [] as [],
    cards: [] as string[],
    onlyReview: false,
    onlyUnclassified: false,
    includeTransfers: true,
    limit: 50,
    offset: 0,
  };

  test("un moviment enllaçat duu serieId", async () => {
    const c = await category("subscripcions");
    const netflix = await merchant("NETFLIX");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`n${i}`, addDays(today, -days), "-12.99", c, netflix);
    }
    await detectRecurring(ledgerId);

    const page = await listTransactions(ledgerId, baseFilter);
    expect(page.items).toHaveLength(3);
    expect(page.items.every((i) => i.seriesId !== null)).toBe(true);
  });

  test("els previstos no surten a la llista de moviments", async () => {
    const c = await category("lloguer");
    await createSeriesManual(ledgerId, {
      label: "Lloguer pis",
      categoryId: c,
      cadence: "monthly",
      expectedAmount: "-850.00",
      nextExpectedDate: addDays(todayLocal(), 3),
    });

    const page = await listTransactions(ledgerId, baseFilter);
    expect(page.items.every((i) => i.seriesId === null || i.id > 0)).toBe(true);
    expect(page.items.some((i) => i.description === "Lloguer pis")).toBe(false);
  });

  test("aparicionsSerie torna els moviments enllaçats", async () => {
    const c = await category("subscripcions");
    const spotify = await merchant("SPOTIFY");
    const today = todayLocal();
    for (const [i, days] of [90, 60, 30].entries()) {
      await transaction(`s${i}`, addDays(today, -days), "-9.99", c, spotify);
    }
    await detectRecurring(ledgerId);
    const [series] = await listSeries(ledgerId, { statuses: ["suggested"] });
    expect(series).toBeDefined();
    if (!series) return;

    const occurrences = await seriesOccurrences(series.id, ledgerId);
    expect(occurrences).toHaveLength(3);
  });
});
