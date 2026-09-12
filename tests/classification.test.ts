/**
 * Merchant memory and review queue, inside a workspace.
 *
 * A port of `backend/tests/test_classification.py`. The invariant checked
 * throughout: **nothing touches what a person decided**.
 *
 * A database is needed:
 *   DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  merchants,
  rules,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { classifyTransaction, classifyPending } from "../src/services/classification.ts";
import { seedCategories } from "../src/services/seed.ts";
import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./helpers.ts";

const Today = "2026-02-10";

let personalId = 0;
let calellaId = 0;
let accountPersonal = 0;
let accountCalella = 0;
let session = { cookie: "", csrf: "" };

async function send(url: string, body: Record<string, string | string[]>): Promise<Response> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.set(key, value);
  }
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookie,
      "X-CSRF-Token": session.csrf,
      "HX-Request": "true",
    },
    body: params.toString(),
  });
}

async function category(ledgerId: number, slug = "alimentacio-supermercat") {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta la categoria ${slug}`);
  return c;
}

interface TransactionOptions {
  amount?: string;
  day?: string;
  normalized?: string;
  merchantId?: number | null;
  categoryId?: number | null;
  categorySource?: "none" | "user" | "rule" | "merchant" | "llm";
  needsReview?: boolean;
  accountId?: number;
  ledgerId?: number;
}

async function transaction(options: TransactionOptions = {}): Promise<number> {
  const amount = options.amount ?? "-30.00";
  const day = options.day ?? Today;
  const normalized = options.normalized ?? "MERCADONA";
  const accountId = options.accountId ?? accountPersonal;

  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId: options.ledgerId ?? personalId,
      dedupKey: `k-${accountId}-${amount}-${day}-${normalized.slice(0, 8)}`,
      source: "enablebanking",
      bookingDate: day,
      amount,
      currency: "EUR",
      status: "booked",
      description: `COMPRA EN ${normalized}`,
      normalizedDescription: normalized,
      counterparty: "",
      bankTransactionCode: "",
      merchantId: options.merchantId ?? null,
      categoryId: options.categoryId ?? null,
      categorySource: options.categorySource ?? "none",
      needsReview: options.needsReview ?? false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    })
    .returning();
  return row?.id ?? 0;
}

async function merchant(
  name = "MERCADONA",
  extra: Partial<typeof merchants.$inferInsert> = {},
) {
  const [m] = await db
    .insert(merchants)
    .values({
      ledgerId: personalId,
      normalizedName: name,
      displayName: name.charAt(0) + name.slice(1).toLowerCase(),
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      ...extra,
    })
    .returning();
  return m?.id ?? 0;
}

/** Reads a transaction back from the database. */
async function read(id: number) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!row) throw new Error("el moviment ha desaparegut");
  return row;
}

async function classify(id: number): Promise<void> {
  const row = await read(id);
  await classifyTransaction({
    id: row.id,
    ledgerId: row.ledgerId,
    merchantId: row.merchantId,
    categorySource: row.categorySource,
  });
}

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(rules);
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
  personalId = workspaces.find((e) => e.code === "personal")?.id ?? 0;
  calellaId = workspaces.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(personalId);
  await seedCategories(calellaId);

  const [connection] = await db
    .insert(bankConnections)
    .values({
      name: "S",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();

  const accountList = await db
    .insert(accounts)
    .values(
      [
        { uid: "uid-1", ledgerId: personalId },
        { uid: "uid-2", ledgerId: calellaId },
      ].map((c) => ({
        connectionId: connection?.id ?? 0,
        ledgerId: c.ledgerId,
        ebAccountUid: c.uid,
        name: "C",
        product: "",
        iban: "ES00",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      })),
    )
    .returning();
  accountPersonal = accountList.find((c) => c.ebAccountUid === "uid-1")?.id ?? 0;
  accountCalella = accountList.find((c) => c.ebAccountUid === "uid-2")?.id ?? 0;

  const [anna] = await db
    .insert(users)
    .values({
      email: "anna@exemple.cat",
      fullName: "Anna",
      passwordHash: await hashPassword(PASSWORD),
      isAdmin: false,
      isActive: true,
    })
    .returning();

  await db.insert(userLedgerPermissions).values([
    { userId: anna?.id ?? 0, ledgerId: personalId, role: "admin" },
    { userId: anna?.id ?? 0, ledgerId: calellaId, role: "admin" },
  ]);

  session = await signIn("anna@exemple.cat");
});

describe("the merchant memory", () => {
  test("classifies from the merchant", async () => {
    const supermercat = await category(personalId);
    const merchantId = await merchant("MERCADONA", {
      defaultCategoryId: supermercat.id,
      isConfirmed: true,
    });
    const id = await transaction({ merchantId: merchantId });

    await classify(id);

    const row = await read(id);
    expect(row.categoryId).toBe(supermercat.id);
    expect(row.categorySource).toBe("merchant");
    expect(row.needsReview).toBe(false);
  });

  test("an unconfirmed merchant is marked for review", async () => {
    const supermercat = await category(personalId);
    const merchantId = await merchant("MERCADONA", {
      defaultCategoryId: supermercat.id,
      isConfirmed: false,
    });
    const id = await transaction({ merchantId: merchantId });

    await classify(id);

    expect((await read(id)).needsReview).toBe(true);
  });
});

describe("what a person decides", () => {
  test("is never overwritten, not even by a merchant", async () => {
    const supermercat = await category(personalId);
    const restaurants = await category(personalId, "restauracio-restaurants");
    const merchantId = await merchant("MERCADONA", {
      defaultCategoryId: supermercat.id,
      isConfirmed: true,
    });
    const id = await transaction({
      merchantId: merchantId,
      categoryId: restaurants.id,
      categorySource: "user",
    });

    await classify(id);

    expect((await read(id)).categoryId).toBe(restaurants.id);
  });
});

describe("the review queue", () => {
  test("transactions with nothing are left for review", async () => {
    const id = await transaction({ normalized: "ALGUNA COSA RARA" });

    const stats = await classifyPending(personalId);

    expect(stats.pending).toBe(1);
    expect((await read(id)).needsReview).toBe(true);
  });

  test("the review page only lists the pending ones", async () => {
    await transaction({ needsReview: true });
    await transaction({ amount: "-10.00", day: "2026-02-08" });

    const res = await app.request("/e/personal/moviments/revisio", {
      headers: { Cookie: session.cookie },
    });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("-30,00");
    expect(body).not.toContain("-10,00");
  });
});

describe("correcting a category", () => {
  test("remembers the merchant and propagates it to its transactions", async () => {
    const merchantId = await merchant();
    const first = await transaction({ merchantId: merchantId });
    const second = await transaction({
      amount: "-12.00",
      day: "2026-02-09",
      merchantId: merchantId,
    });
    const supermercat = await category(personalId);

    const res = await send(`/e/personal/moviments/${first}/categoria`, {
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(200);
    const [rowMerchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(rowMerchant?.defaultCategoryId).toBe(supermercat.id);
    expect(rowMerchant?.isConfirmed).toBe(true);
    expect((await read(second)).categoryId).toBe(supermercat.id);
  });
});

describe("the id in the URL", () => {
  test("something that is not a number gives 404, not 500", async () => {
    const res = await send("/e/personal/moviments/no-soc-un-numero/categoria", {
      category_id: "1",
    });
    expect(res.status).toBe(404);
  });

  test("and so does a number with a tail glued on", async () => {
    // `Number.parseInt("12abc")` returns 12: this used to be a valid URL that
    // ended up on transaction 12.
    const id = await transaction();
    const res = await send(`/e/personal/moviments/${id}abc/categoria`, {
      category_id: String((await category(personalId)).id),
    });
    expect(res.status).toBe(404);
    // And transaction 12 has not been touched.
    expect((await read(id)).categorySource).toBe("none");
  });
});

describe("when a request fails", () => {
  /**
   * A body carrying only the `#toast` is left empty when HTMX takes the
   * out-of-band swaps out of it, and then HTMX would swap that emptiness into
   * the `hx-target`. With `hx-swap="outerHTML"` that deletes the row the user
   * was touching. `HX-Reswap: none` prevents it.
   */
  test("the error does not take the row with it: `HX-Reswap: none` has to be there", async () => {
    const id = await transaction();
    const foreign = await category(calellaId);

    const res = await send(`/e/personal/moviments/${id}/categoria`, {
      category_id: String(foreign.id),
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("HX-Reswap")).toBe("none");
    // And the body only carries the `#toast`, out of band. The container's
    // content is changed and not the container: otherwise the replacement
    // `#toast` would lose its `aria-live` and stop being a live region.
    const body = await res.text();
    expect(body).toContain('hx-swap-oob="innerHTML:#toast"');
  });

  test("also when nothing is found", async () => {
    const res = await send("/e/personal/moviments/999999/categoria", {
      category_id: String((await category(personalId)).id),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("HX-Reswap")).toBe("none");
  });

  test("and when the bulk selection carries a transaction from outside", async () => {
    const own = await transaction();
    const foreign = await transaction({ accountId: accountCalella, ledgerId: calellaId });

    const res = await send("/e/personal/moviments/bloc", {
      transaction: [String(own), String(foreign)],
      category_id: String((await category(personalId)).id),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("HX-Reswap")).toBe("none");
  });
});

describe("bulk recategorization", () => {
  test("applies the category to all the selected ones", async () => {
    const first = await transaction();
    const second = await transaction({ amount: "-40.00", day: "2026-02-09" });
    const supermercat = await category(personalId);

    const res = await send("/e/personal/moviments/bloc", {
      transaction: [String(first), String(second)],
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(200);
    expect((await read(first)).categoryId).toBe(supermercat.id);
    expect((await read(second)).categoryId).toBe(supermercat.id);
  });

  test("if any transaction is not from the workspace, none is applied", async () => {
    const own = await transaction();
    const foreign = await transaction({ accountId: accountCalella, ledgerId: calellaId });
    const supermercat = await category(personalId);

    const res = await send("/e/personal/moviments/bloc", {
      transaction: [String(own), String(foreign)],
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(404);
    expect((await read(own)).categorySource).toBe("none");
    expect((await read(foreign)).categorySource).toBe("none");
  });
});
