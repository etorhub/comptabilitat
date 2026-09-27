/**
 * The written reports, end to end, against a local fake of Ollama.
 *
 * What matters here, in order:
 *
 *   1. **The figures come from the database**, and so does what is called
 *      unexpected. The fake model only writes prose.
 *   2. **Masking holds**: a masked transaction appears by its alias, and its
 *      merchant is neither named to the model nor drawn.
 *   3. **Without the model there is no report**, and a failed regeneration
 *      leaves the previous report standing.
 *   4. **The monthly job catches up** after a bad night, and gives up after a
 *      few.
 *   5. **Workspaces stay sealed** and only editors regenerate.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { checkDocument, formatViolations } from "../htmx-contract/index.ts";
import { db } from "../src/db/client.ts";
import {
  accounts,
  aiReports,
  balances,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { config } from "../src/lib/config.ts";
import { todayLocal } from "../src/lib/time.ts";
import {
  failStuckReports,
  generateReport,
  pruneDailyReports,
  reportOf,
  reportQueueIdle,
} from "../src/services/ai-reports.ts";
import { dailyFacts, monthlyFacts } from "../src/services/report-facts.ts";
import { monthlyReportsJob } from "../src/workers/jobs/reports.ts";
import { PASSWORD, requestAs, signIn, type Session } from "./helpers.ts";

/** The `config` is `as const` for the type, but the fields can be touched. */
const settings = config as {
  ollamaEnabled: boolean;
  ollamaBaseUrl: string;
  reportPauseSeconds: number;
};

// --- The fake model --------------------------------------------------------

let prompts: string[] = [];
let failing = false;
let ollama: ReturnType<typeof Bun.serve> | undefined;

beforeAll(() => {
  ollama = Bun.serve({
    port: 0,
    async fetch(req) {
      if (failing) return new Response("caigut", { status: 500 });
      const body = (await req.json()) as { messages: { content: string }[] };
      prompts.push(body.messages[1]?.content ?? "");
      return Response.json({
        message: {
          content: JSON.stringify({
            resum: "El mes ha anat bé, amb alguna sorpresa.",
            punts: ["Heu gastat més en oci.", "La llum ha pujat."],
          }),
        },
      });
    },
  });
});

afterAll(async () => {
  await ollama?.stop(true);
});

// --- The workspace ---------------------------------------------------------

let personalId = 0;
let calellaId = 0;
let accountId = 0;
let anna: Session;
let pere: Session;
let joan: Session;

const HISTORY = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

async function category(name: string, kind: "income" | "expense" = "expense"): Promise<number> {
  const [row] = await db
    .insert(categories)
    .values({
      ledgerId: personalId,
      slug: name.toLowerCase(),
      name,
      kind,
      color: "#123456",
      icon: "",
      isSystem: false,
      position: 0,
    })
    .returning({ id: categories.id });
  return row?.id ?? 0;
}

async function merchant(name: string): Promise<number> {
  const [row] = await db
    .insert(merchants)
    .values({
      ledgerId: personalId,
      normalizedName: name.toUpperCase(),
      displayName: name,
      categorySource: "user",
      isConfirmed: true,
      transactionCount: 0,
    })
    .returning({ id: merchants.id });
  return row?.id ?? 0;
}

async function movement(values: {
  date: string;
  amount: string;
  description: string;
  categoryId?: number | null;
  merchantId?: number | null;
  displayDescription?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId: personalId,
      dedupKey: `k-${Math.random()}`,
      source: "enablebanking",
      bookingDate: values.date,
      amount: values.amount,
      currency: "EUR",
      status: "booked",
      description: values.description,
      normalizedDescription: values.description,
      counterparty: "",
      bankTransactionCode: "",
      merchantId: values.merchantId ?? null,
      categoryId: values.categoryId ?? null,
      categorySource: "user",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: { iban: "ES9121000418450200051332" },
      displayDescription: values.displayDescription ?? null,
    })
    .returning({ id: transactions.id });
  return row?.id ?? 0;
}

beforeEach(async () => {
  settings.ollamaEnabled = true;
  settings.ollamaBaseUrl = `http://127.0.0.1:${ollama?.port ?? 0}`;
  settings.reportPauseSeconds = 0;
  prompts = [];
  failing = false;

  await db.delete(aiReports);
  await db.delete(recurringSeries);
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const workspaces = await db
    .insert(ledgers)
    .values(
      ["personal", "calella"].map((code, i) => ({
        code,
        name: code === "personal" ? "Personal" : "Calella",
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
  personalId = workspaces.find((w) => w.code === "personal")?.id ?? 0;
  calellaId = workspaces.find((w) => w.code === "calella")?.id ?? 0;

  const passwordHash = await hashPassword(PASSWORD);
  const people = await db
    .insert(users)
    .values(
      ["anna", "pere", "joan"].map((name) => ({
        email: `${name}@exemple.cat`,
        fullName: name,
        passwordHash,
        isAdmin: false,
        isActive: true,
      })),
    )
    .returning();
  const id = (name: string) => people.find((p) => p.fullName === name)?.id ?? 0;
  await db.insert(userLedgerPermissions).values([
    { userId: id("anna"), ledgerId: personalId, role: "editor" },
    { userId: id("pere"), ledgerId: personalId, role: "viewer" },
    { userId: id("joan"), ledgerId: calellaId, role: "admin" },
  ]);

  const [connection] = await db
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
  const [account] = await db
    .insert(accounts)
    .values({
      connectionId: connection?.id ?? 0,
      ledgerId: personalId,
      ebAccountUid: "uid-informes",
      name: "Compte corrent",
      product: "",
      iban: "ES9121000418450200051332",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  accountId = account?.id ?? 0;
  await db.insert(balances).values({
    accountId,
    balanceType: "CLBD",
    amount: "1234.56",
    currency: "EUR",
    referenceDate: "2026-09-26",
    fetchedAt: new Date(),
  });

  const salary = await category("Nomina", "income");
  const home = await category("Casa");
  const [light] = await db
    .insert(categories)
    .values({
      ledgerId: personalId,
      parentId: home,
      slug: "llum",
      name: "Llum",
      kind: "expense",
      color: "#123456",
      icon: "",
      isSystem: false,
      position: 0,
    })
    .returning({ id: categories.id });
  const lightId = light?.id ?? 0;
  const groceries = await category("Supermercat");
  const leisure = await category("Oci");
  const car = await category("Cotxe");

  const mercadona = await merchant("Mercadona");
  const endesa = await merchant("Endesa");
  const garage = await merchant("Taller Pepe");
  const shop = await merchant("Botiga Nova");
  const secret = await merchant("SECRETSHOP");

  const [series] = await db
    .insert(recurringSeries)
    .values({
      ledgerId: personalId,
      signature: `c${lightId}|m${endesa}|out`,
      label: "Endesa",
      merchantId: endesa,
      categoryId: lightId,
      cadence: "monthly",
      expectedAmount: "-60.00",
      amountTolerance: "6.00",
      amountMode: "exact",
      intervalDays: 30,
      confidence: 0.9,
      occurrencesCount: 7,
      firstSeenDate: "2026-02-10",
      lastSeenDate: "2026-08-10",
      nextExpectedDate: "2026-09-28",
      status: "active",
      includeInForecast: true,
    })
    .returning({ id: recurringSeries.id });
  const seriesId = series?.id ?? 0;

  const bill = async (date: string, amount: string) => {
    const transactionId = await movement({
      date,
      amount,
      description: "ENDESA RECIBO",
      categoryId: lightId,
      merchantId: endesa,
    });
    await db
      .insert(recurringOccurrences)
      .values({ seriesId, transactionId, occurredOn: date, amount });
  };

  // Six ordinary months.
  for (const month of HISTORY) {
    await movement({
      date: `${month}-01`,
      amount: "2000.00",
      description: "NOMINA",
      categoryId: salary,
    });
    await movement({
      date: `${month}-05`,
      amount: "-300.00",
      description: "MERCADONA",
      categoryId: groceries,
      merchantId: mercadona,
    });
    await bill(`${month}-10`, "-60.00");
    await movement({
      date: `${month}-15`,
      amount: "-40.00",
      description: "CINEMA",
      categoryId: leisure,
    });
  }

  // August, with surprises.
  await movement({
    date: "2026-08-01",
    amount: "2000.00",
    description: "NOMINA",
    categoryId: salary,
  });
  await movement({
    date: "2026-08-05",
    amount: "-300.00",
    description: "MERCADONA",
    categoryId: groceries,
    merchantId: mercadona,
  });
  await bill("2026-08-10", "-90.00");
  await movement({
    date: "2026-08-15",
    amount: "-200.00",
    description: "CONCERT",
    categoryId: leisure,
  });
  await movement({
    date: "2026-08-12",
    amount: "-380.00",
    description: "TALLER PEPE",
    categoryId: car,
    merchantId: garage,
  });
  await movement({
    date: "2026-08-20",
    amount: "-45.00",
    description: "BOTIGA NOVA",
    categoryId: leisure,
    merchantId: shop,
  });
  await movement({
    date: "2026-08-22",
    amount: "-150.00",
    description: "SECRETSHOP COMPRA",
    merchantId: secret,
    displayDescription: "Regal secret",
  });

  // September so far.
  await movement({
    date: "2026-09-05",
    amount: "-100.00",
    description: "MERCADONA",
    categoryId: groceries,
    merchantId: mercadona,
  });

  anna = await signIn("anna@exemple.cat");
  pere = await signIn("pere@exemple.cat");
  joan = await signIn("joan@exemple.cat");
});

afterEach(async () => {
  await reportQueueIdle();
  settings.ollamaEnabled = false;
});

function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HX-Request": "true",
    },
    body: new URLSearchParams(values).toString(),
  };
}

const personal = { id: 0, name: "Personal" };

// --- The figures -------------------------------------------------------------

describe("the figures", () => {
  test("the month's totals and what was unexpected come from the rows", async () => {
    const facts = await monthlyFacts(personalId, "2026-08");

    expect(facts.totals).toEqual({ income: "2000.00", expenses: "1165.00", result: "835.00" });
    expect(facts.previous.expenses).toBe("400.00");
    expect(facts.fixedExpenses).toBe("90.00");

    const u = facts.unexpected;
    // The weekly shop is habitual: big, but not unexpected.
    expect(u.outsideRecurring.map((e) => e.label)).toEqual([
      "Taller Pepe",
      "Concert",
      "Regal secret",
    ]);
    // A category never used before counts too; the biggest excess goes first.
    expect(u.categorySpikes).toEqual([
      { category: "Cotxe", amount: "380.00", usual: "0.00" },
      { category: "Oci", amount: "245.00", usual: "40.00" },
    ]);
    expect(u.dearerBills).toEqual([
      { label: "Endesa", date: "2026-08-10", amount: "90.00", expected: "60.00" },
    ]);
    // The masked one is not named by its merchant.
    expect(u.newMerchants.map((m) => m.label)).toEqual(["Taller Pepe", "Botiga Nova"]);
  });

  test("the brief compares with last month and looks ahead to the month's end", async () => {
    const facts = await dailyFacts(personalId, "2026-09-27");

    expect(facts.totals.expenses).toBe("100.00");
    expect(facts.lastMonthToDate.expenses).toBe("1165.00");
    expect(facts.balance).toBe("1234.56");
    expect(facts.expected).toEqual([{ date: "2026-09-28", label: "Endesa", amount: "-60.00" }]);
    expect(facts.projectedBalance).toBe("1174.56");
  });
});

// --- Writing -----------------------------------------------------------------

describe("writing a report", () => {
  test("the model gets figures, never a masked merchant or an IBAN", async () => {
    const written = await generateReport({ ...personal, id: personalId }, "monthly", "2026-08");
    expect(written).toBe(true);

    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("Taller Pepe");
    expect(prompt).toContain("Despeses: 1.165,00");
    expect(prompt).toContain("Regal secret");
    expect(prompt).not.toContain("SECRETSHOP");
    expect(prompt).not.toContain("ES91");

    const report = await reportOf(personalId, "monthly", "2026-08");
    expect(report?.status).toBe("done");
    expect(report?.text?.resum).toContain("El mes ha anat bé");
    expect(report?.facts?.kind).toBe("monthly");
  });

  test("without the model there is no report", async () => {
    settings.ollamaEnabled = false;
    expect(await generateReport({ ...personal, id: personalId }, "monthly", "2026-08")).toBe(
      false,
    );
    const report = await reportOf(personalId, "monthly", "2026-08");
    expect(report?.status).toBe("error");
    expect(report?.text).toBeNull();
    expect(report?.facts).toBeNull();
    expect(prompts).toHaveLength(0);
  });

  test("a failed regeneration leaves the previous report standing", async () => {
    await generateReport({ ...personal, id: personalId }, "monthly", "2026-08");
    failing = true;
    expect(await generateReport({ ...personal, id: personalId }, "monthly", "2026-08")).toBe(
      false,
    );

    const report = await reportOf(personalId, "monthly", "2026-08");
    expect(report?.status).toBe("done");
    expect(report?.text?.resum).toContain("El mes ha anat bé");
    expect(report?.error).toContain("Ollama no ha respost");
  });
});

// --- The monthly job ---------------------------------------------------------

describe("the monthly job", () => {
  test("waits for the late bookings, then writes only what is missing", async () => {
    expect(await monthlyReportsJob({ today: "2026-09-02" })).toContain("encara no toca");
    expect(prompts).toHaveLength(0);

    const first = await monthlyReportsJob({ today: "2026-09-03" });
    expect(first).toContain("Personal: fet");
    // Calella has no transactions: no report, no model call.
    expect(first).toContain("Calella: sense moviments");
    expect(prompts).toHaveLength(1);

    const second = await monthlyReportsJob({ today: "2026-09-04" });
    expect(second).toContain("Personal: ja estava fet");
    expect(prompts).toHaveLength(1);
  });

  test("catches up after a bad night, and gives up after a few", async () => {
    failing = true;
    for (const day of ["03", "04", "05"]) {
      expect(await monthlyReportsJob({ today: `2026-09-${day}` })).toContain("(1 errors)");
    }
    const [row] = await db
      .select({ attempts: aiReports.attempts })
      .from(aiReports)
      .where(and(eq(aiReports.ledgerId, personalId), eq(aiReports.period, "2026-08")));
    expect(row?.attempts).toBe(3);

    failing = false;
    expect(await monthlyReportsJob({ today: "2026-09-06" })).toContain("intents fallits");
    // A person asking writes it anyway.
    expect(await monthlyReportsJob({ today: "2026-09-06", force: true })).toContain(
      "Personal: fet",
    );
  });
});

// --- Housekeeping ------------------------------------------------------------

describe("housekeeping", () => {
  test("a report left pending by a dead process is closed", async () => {
    await db.insert(aiReports).values({
      ledgerId: personalId,
      kind: "daily",
      period: "2026-09-27",
      status: "pending",
      model: "",
      promptVersion: "1",
      error: "",
      attempts: 0,
      startedAt: new Date(Date.now() - 3_600_000 * 3),
    });
    expect(await failStuckReports()).toBe(1);
    expect((await reportOf(personalId, "daily", "2026-09-27"))?.status).toBe("error");
  });

  test("old daily briefs are deleted, monthly reports are kept", async () => {
    await generateReport({ ...personal, id: personalId }, "daily", "2026-07-01");
    await generateReport({ ...personal, id: personalId }, "monthly", "2026-06");
    expect(await pruneDailyReports("2026-09-27")).toBe(1);
    expect(await reportOf(personalId, "monthly", "2026-06")).not.toBeNull();
  });
});

// --- The pages ---------------------------------------------------------------

describe("the pages", () => {
  test("any member reads them; only editors see the button", async () => {
    await generateReport({ ...personal, id: personalId }, "monthly", "2026-08");

    const page = await requestAs(pere, "/e/personal/resums");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("agost del 2026");
    expect(html).not.toContain("Regenera");
    expect(formatViolations(await checkDocument(html))).toBe("no violations");

    const detail = await (await requestAs(pere, "/e/personal/resums/2026-08")).text();
    expect(detail).toContain("El mes ha anat bé");
    expect(detail).toContain("Taller Pepe");
    expect(detail).toContain("Regal secret");
    expect(detail).not.toContain("SECRETSHOP");
    expect(formatViolations(await checkDocument(detail))).toBe("no violations");

    const asEditor = await (await requestAs(anna, "/e/personal/resums/2026-08")).text();
    expect(asEditor).toContain("Regenera");
  });

  test("another workspace's report is a 404, like one that does not exist", async () => {
    await generateReport({ ...personal, id: personalId }, "monthly", "2026-08");

    const theirs = await requestAs(joan, "/e/personal/resums/2026-08");
    const missing = await requestAs(joan, "/e/calella/resums/2026-08");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);

    const fragment = await requestAs(
      joan,
      "/e/calella/resums/fragment/informe?tipus=mensual&periode=2026-08",
    );
    expect(await fragment.text()).not.toContain("El mes ha anat bé");
  });

  test("regenerating returns the report pending, polls, and ends written", async () => {
    const today = todayLocal();
    const res = await requestAs(
      anna,
      "/e/personal/resums/regenera",
      form({ tipus: "diari", periode: today }),
    );
    expect(res.status).toBe(200);
    const pending = await res.text();
    expect(pending).toContain("S'està redactant");
    expect(pending).toContain("hx-trigger");
    expect(formatViolations(await checkDocument(pending, { fragment: true }))).toBe(
      "no violations",
    );

    await reportQueueIdle();

    const done = await (
      await requestAs(
        anna,
        `/e/personal/resums/fragment/informe?tipus=diari&periode=${today}&intent=1`,
      )
    ).text();
    expect(done).toContain("El mes ha anat bé");
    expect(done).not.toContain("hx-trigger");
  });

  test("a viewer cannot regenerate, nor can anyone without the model", async () => {
    const today = todayLocal();
    const asViewer = await requestAs(
      pere,
      "/e/personal/resums/regenera",
      form({ tipus: "diari", periode: today }),
    );
    expect(asViewer.status).toBe(403);

    settings.ollamaEnabled = false;
    const disabled = await requestAs(
      anna,
      "/e/personal/resums/regenera",
      form({ tipus: "diari", periode: today }),
    );
    expect(disabled.status).toBe(409);
    expect(disabled.headers.get("HX-Reswap")).toBe("none");
  });

  test("only today's brief and a finished month can be written", async () => {
    const yesterday = await requestAs(
      anna,
      "/e/personal/resums/regenera",
      form({ tipus: "diari", periode: "2020-01-01" }),
    );
    expect(yesterday.status).toBe(422);

    const thisMonth = await requestAs(
      anna,
      "/e/personal/resums/regenera",
      form({ tipus: "mensual", periode: todayLocal().slice(0, 7) }),
    );
    expect(thisMonth.status).toBe(422);
    expect(prompts).toHaveLength(0);
  });
});
