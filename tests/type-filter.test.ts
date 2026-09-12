/**
 * Filter by operation type and transfer label.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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
import { hashPassword } from "../src/lib/auth.ts";
import { FilterBar } from "../src/routes/transactions/transactions.fragment.ts";
import {
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "../src/routes/transactions/transactions.schema.ts";
import { seedCategories } from "../src/services/seed.ts";
import { listTransactions, cardsAvailable } from "../src/services/transactions.ts";
import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./helpers.ts";

let ledgerId = 0;
let accountId = 0;

const baseFilter = {
  accountId: null as number | null,
  dateFrom: null as string | null,
  dateTo: null as string | null,
  categoryIds: [] as number[],
  merchantId: null as number | null,
  search: "",
  tag: null as string | null,
  operationType: [] as ("targeta" | "transferencia" | "bizum" | "rebut" | "altres")[],
  cards: [] as string[],
  onlyReview: false,
  onlyUnclassified: false,
  includeTransfers: true,
  limit: 50,
  offset: 0,
};

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
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
      ledgerId,
      ebAccountUid: "uid-tipus",
      name: "Compte",
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

  const base = {
    accountId,
    ledgerId,
    source: "manual" as const,
    bookingDate: "2026-03-01",
    amount: "-10.00",
    currency: "EUR",
    status: "booked" as const,
    normalizedDescription: "X",
    counterparty: "",
    bankTransactionCode: "",
    merchantId: null,
    categoryId: null,
    categorySource: "none" as const,
    needsReview: false,
    notes: "",
    tags: [] as string[],
    isExcluded: false,
    raw: {},
  };

  await db.insert(transactions).values([
    {
      ...base,
      dedupKey: "card",
      description: "COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA",
      normalizedDescription: "MERCADONA",
    },
    {
      ...base,
      dedupKey: "wire",
      description: "TRANSFERENCIA IMMEDIATA A FAVOR DE Maria Lopez",
      normalizedDescription: "MARIA LOPEZ",
      amount: "-50.00",
    },
    {
      ...base,
      dedupKey: "bizum",
      description: "BIZUM ENVIADO A JOAN",
      normalizedDescription: "JOAN",
      amount: "-5.00",
    },
    {
      ...base,
      dedupKey: "recibo",
      description: "RECIBO AJUNTAMENT DE BARCELONA, concepto: IBI",
      normalizedDescription: "AJUNTAMENT",
      amount: "-100.00",
    },
    {
      ...base,
      dedupKey: "other",
      description: "LIQUIDACION INTERESES",
      normalizedDescription: "INTERESES",
      amount: "-1.00",
    },
  ]);
});

describe("filter by operation type", () => {
  test("transfers only", async () => {
    const page = await listTransactions(ledgerId, {
      ...baseFilter,
      operationType: ["transferencia"],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.description).toBe("Maria Lopez");
    expect(page.items[0]?.operationType).toBe("transferencia");
  });

  test("card or bizum (OR)", async () => {
    const page = await listTransactions(ledgerId, {
      ...baseFilter,
      operationType: ["targeta", "bizum"],
    });
    const descriptions = page.items.map((i) => i.description).toSorted();
    expect(descriptions).toEqual(["Joan", "Mercadona"]);
  });

  test("others excludes card, transfer, bizum and direct debit", async () => {
    const page = await listTransactions(ledgerId, {
      ...baseFilter,
      operationType: ["altres"],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.description).toMatch(/Intereses|Liquidacion/i);
  });
});

describe("filter by a particular card", () => {
  test("only that card's transactions", async () => {
    const page = await listTransactions(ledgerId, {
      ...baseFilter,
      cards: ["1234"],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.description).toBe("Mercadona");
  });

  test("no card selected filters nothing", async () => {
    const page = await listTransactions(ledgerId, { ...baseFilter, cards: [] });
    expect(page.items).toHaveLength(5);
  });

  test("cardsAvailable returns the last 4 digits used on the account", async () => {
    const cards = await cardsAvailable(ledgerId, accountId);
    expect(cards).toEqual(["1234"]);
  });

  test("cardsAvailable does not reveal a masked transaction's card", async () => {
    await db
      .update(transactions)
      .set({ displayDescription: "Despesa personal" })
      .where(eq(transactions.dedupKey, "card"));

    const cards = await cardsAvailable(ledgerId, accountId);
    expect(cards).toEqual([]);
  });
});

describe("type filter schema", () => {
  test("accepts a single value or a list", () => {
    expect(transactionFiltersSchema.parse({ type: "transferencia" }).type).toEqual([
      "transferencia",
    ]);
    expect(
      transactionFiltersSchema.parse({ type: ["targeta", "bizum", "targeta"] }).type,
    ).toEqual(["targeta", "bizum"]);
  });

  test("serializes repeated types into the query", () => {
    const q = transactionFiltersToQuery(
      transactionFiltersSchema.parse({ type: ["targeta", "rebut"], pagina: 1 }),
    );
    expect(q).toContain("tipus=targeta");
    expect(q).toContain("tipus=rebut");
    expect(q).toContain("pagina=1");
  });

  test("card accepts 4 digits only", () => {
    expect(transactionFiltersSchema.parse({ card: ["1234", "abcd", "12345"] }).card).toEqual([
      "1234",
    ]);
    expect(transactionFiltersSchema.parse({ card: ["1234", "5678", "1234"] }).card).toEqual([
      "1234",
      "5678",
    ]);
  });

  test("serializes repeated cards into the query", () => {
    const q = transactionFiltersToQuery(
      transactionFiltersSchema.parse({ card: ["1234", "5678"] }),
    );
    expect(q).toContain("targeta=1234");
    expect(q).toContain("targeta=5678");
  });

  test("the bar shows the type checkboxes", async () => {
    const html = String(
      await FilterBar({
        code: "personal",
        filters: transactionFiltersSchema.parse({ type: "transferencia" }),
        accountList: [],
        groups: [],
      }),
    );
    expect(html).toContain('name="tipus"');
    expect(html).toContain('value="transferencia"');
    expect(html).toContain("checked");
    expect(html).toContain("Targeta");
  });

  test("the bar shows the card checkboxes when there are any", async () => {
    const html = String(
      await FilterBar({
        code: "personal",
        filters: transactionFiltersSchema.parse({ card: "1234" }),
        accountList: [],
        groups: [],
        knownCards: ["1234"],
      }),
    );
    expect(html).toContain('name="targeta"');
    expect(html).toContain('value="1234"');
    expect(html).toContain("checked");
  });

  test("with no known cards there is no fieldset", async () => {
    const html = String(
      await FilterBar({
        code: "personal",
        filters: transactionFiltersSchema.parse({}),
        accountList: [],
        groups: [],
      }),
    );
    expect(html).not.toContain('name="targeta"');
  });
});

describe("transactions route with a type filter", () => {
  test("the page and the fragment do not return the same, and the push keeps the type", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "filtre-tipus@exemple.cat",
        fullName: "Filtre",
        passwordHash: await hashPassword(PASSWORD),
        isActive: true,
        isAdmin: false,
      })
      .returning();
    await db.insert(userLedgerPermissions).values({
      userId: user?.id ?? 0,
      ledgerId,
      role: "editor",
    });
    const { cookie } = await signIn("filtre-tipus@exemple.cat");

    const page = await app.request("/e/personal/moviments?tipus=transferencia", {
      headers: { Cookie: cookie },
    });
    const frag = await app.request("/e/personal/moviments/fragment/taula?tipus=transferencia", {
      headers: { Cookie: cookie },
    });
    expect(page.status).toBe(200);
    expect(frag.status).toBe(200);

    const pageHtml = await page.text();
    const htmlFrag = await frag.text();
    expect(pageHtml.toLowerCase()).toContain("<!doctype html");
    expect(htmlFrag.toLowerCase()).not.toContain("<!doctype html");
    expect(pageHtml).toContain("filtre-tipus");
    expect(pageHtml).toContain('name="tipus"');
    expect(htmlFrag).toContain("Maria Lopez");
    expect(htmlFrag).toContain("transferència");
    expect(htmlFrag).not.toContain("Mercadona");
    expect(frag.headers.get("HX-Push-Url")).toContain("tipus=transferencia");
    expect(pageHtml).not.toBe(htmlFrag);
  });

  test("the fragment refreshes the card fieldset with an OOB swap", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "filtre-targeta@exemple.cat",
        fullName: "Filtre targeta",
        passwordHash: await hashPassword(PASSWORD),
        isActive: true,
        isAdmin: false,
      })
      .returning();
    await db.insert(userLedgerPermissions).values({
      userId: user?.id ?? 0,
      ledgerId,
      role: "editor",
    });
    const { cookie } = await signIn("filtre-targeta@exemple.cat");

    const frag = await app.request("/e/personal/moviments/fragment/taula?targeta=1234", {
      headers: { Cookie: cookie },
    });
    expect(frag.status).toBe(200);
    const htmlFrag = await frag.text();
    expect(htmlFrag).toContain('id="filtre-targetes"');
    expect(htmlFrag).toContain('hx-swap-oob="true"');
    expect(htmlFrag).toContain('name="targeta"');
    expect(htmlFrag).toContain('value="1234"');
    expect(htmlFrag).toContain("Mercadona");
  });
});
