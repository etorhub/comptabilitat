/**
 * The filters of Informes and Moviments, and the downloads that hang off them.
 *
 * `8688f24` renamed a few wire keys along with the identifiers and nothing
 * failed: the pages simply stopped filtering by «Fins a» and «Mesos», and the
 * CSV ignored almost every filter. What matters here:
 *
 *   1. The filters the form sends are the ones applied.
 *   2. The download links live inside the swapped piece and carry the filters,
 *      so what you download is what you are looking at.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { attributeOf } from "../htmx-contract/index.ts";
import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { PASSWORD, requestAs, signIn, type Session } from "./helpers.ts";

let personalId = 0;
let accountId = 0;
let restaurantsId = 0;
let anna: Session;

async function movement(
  date: string,
  amount: string,
  description: string,
  categoryId?: number,
) {
  await db.insert(transactions).values({
    accountId,
    ledgerId: personalId,
    dedupKey: `k-${Math.random()}`,
    source: "enablebanking",
    bookingDate: date,
    amount,
    currency: "EUR",
    status: "booked",
    description,
    normalizedDescription: description,
    counterparty: "",
    bankTransactionCode: "",
    merchantId: null,
    categoryId: categoryId ?? null,
    categorySource: categoryId ? "user" : "none",
    needsReview: false,
    notes: "",
    tags: [],
    isExcluded: false,
    raw: {},
    displayDescription: null,
  });
}

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const [ledger] = await db
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
  personalId = ledger?.id ?? 0;

  const [user] = await db
    .insert(users)
    .values({
      email: "anna@exemple.cat",
      fullName: "anna",
      passwordHash: await hashPassword(PASSWORD),
      isAdmin: false,
      isActive: true,
    })
    .returning();
  await db
    .insert(userLedgerPermissions)
    .values({ userId: user?.id ?? 0, ledgerId: personalId, role: "viewer" });

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
      ebAccountUid: "uid-filtres",
      name: "Compte corrent",
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

  const [category] = await db
    .insert(categories)
    .values({
      ledgerId: personalId,
      slug: "restaurants",
      name: "Restaurants",
      kind: "expense",
      color: "#123456",
      icon: "",
      isSystem: false,
      position: 0,
    })
    .returning({ id: categories.id });
  restaurantsId = category?.id ?? 0;

  await movement("2026-07-01", "1000.00", "NOMINA JULIOL");
  await movement("2026-07-10", "-20.00", "GLOVO JULIOL", restaurantsId);
  await movement("2026-07-15", "-30.00", "MERCAT JULIOL");
  await movement("2026-09-10", "-40.00", "GLOVO SETEMBRE", restaurantsId);

  anna = await signIn("anna@exemple.cat");
});

/** The link as the browser follows it: `&amp;` in the markup is `&`. */
async function hrefOf(html: string, selector: string): Promise<string> {
  return ((await attributeOf(html, selector, "href")) ?? "").replaceAll("&amp;", "&");
}

describe("Informes", () => {
  test("«Fins a» applies, and the URL keeps it", async () => {
    const res = await requestAs(
      anna,
      "/e/personal/informes/fragment/contingut?des=2026-07-01&fins=2026-07-31",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Push-Url")).toBe(
      "/e/personal/informes?des=2026-07-01&fins=2026-07-31",
    );
    const html = await res.text();
    expect(html).toContain("1.000,00");
    // July only: 20 + 30, not September's 40.
    expect(html).toContain("50,00");
    expect(html).not.toContain("90,00");
  });

  test("the downloads follow the filters", async () => {
    const html = await (
      await requestAs(
        anna,
        "/e/personal/informes/fragment/contingut?des=2026-07-01&fins=2026-07-31&mesos=6",
      )
    ).text();
    expect(await hrefOf(html, 'a[href*="informe.xlsx"]')).toBe(
      "/e/personal/informes/informe.xlsx?des=2026-07-01&fins=2026-07-31&mesos=6",
    );
    expect(await hrefOf(html, 'a[href*="informe.pdf"]')).toBe(
      "/e/personal/informes/informe.pdf?des=2026-07-01&fins=2026-07-31&mesos=6",
    );

    const xlsx = await requestAs(anna, "/e/personal/informes/informe.xlsx?mesos=6");
    expect(xlsx.status).toBe(200);
    const pdf = await requestAs(
      anna,
      "/e/personal/informes/informe.pdf?des=2026-07-01&fins=2026-07-31",
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
  });
});

describe("Moviments", () => {
  test("«Fins a» applies", async () => {
    const html = await (
      await requestAs(anna, "/e/personal/moviments/fragment/taula?fins=2026-07-31")
    ).text();
    expect(html.toLowerCase()).toContain("juliol");
    expect(html.toLowerCase()).not.toContain("setembre");
  });

  test("the CSV link follows the filters, all pages", async () => {
    const html = await (
      await requestAs(
        anna,
        "/e/personal/moviments/fragment/taula?cerca=glovo&fins=2026-07-31&pagina=0",
      )
    ).text();
    expect(await hrefOf(html, 'a[href*="moviments.csv"]')).toBe(
      "/e/personal/moviments/moviments.csv?cerca=glovo&fins=2026-07-31",
    );
  });

  test("the CSV applies the search, the dates and the category", async () => {
    const csv = async (query: string) => {
      const res = await requestAs(anna, `/e/personal/moviments/moviments.csv${query}`);
      expect(res.status).toBe(200);
      // The header line and one per transaction.
      return (await res.text()).trim().split("\r\n").slice(1).join("\n").toLowerCase();
    };

    const july = await csv("?cerca=glovo&fins=2026-07-31");
    expect(july).toContain("juliol");
    expect(july).not.toContain("setembre");
    expect(july.split("\n")).toHaveLength(1);

    const restaurants = await csv(`?categoria=${restaurantsId}`);
    expect(restaurants.split("\n")).toHaveLength(2);
    expect(restaurants).not.toContain("mercat");
  });
});
