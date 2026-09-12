/**
 * Tags: add/remove, totals, page vs fragment, permissions.
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
  rules,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { money } from "../src/lib/money.ts";
import { seedCategories } from "../src/services/seed.ts";
import {
  addTag,
  deleteTagFromWorkspace,
  listTags,
  sameTag,
  normalizeTag,
  removeTag,
} from "../src/services/tags.ts";
import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./helpers.ts";

let personalId = 0;
let calellaId = 0;
let accountPersonal = 0;
let accountCalella = 0;
let transactionPersonal = 0;
let transactionCalella = 0;
let editorSession = { cookie: "", csrf: "" };
let viewerSession = { cookie: "", csrf: "" };
let adminSession = { cookie: "", csrf: "" };

async function send(
  url: string,
  body: Record<string, string>,
  session = editorSession,
): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookie,
      "X-CSRF-Token": session.csrf,
      "HX-Request": "true",
    },
    body: new URLSearchParams(body).toString(),
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
        name: code,
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

  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(users)
    .values([
      {
        email: "editor@exemple.cat",
        fullName: "Editor",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
      {
        email: "viewer@exemple.cat",
        fullName: "Viewer",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
      {
        email: "admin@exemple.cat",
        fullName: "Admin",
        passwordHash,
        isAdmin: true,
        isActive: true,
      },
    ])
    .returning();
  const editor = created.find((u) => u.email === "editor@exemple.cat");
  const viewer = created.find((u) => u.email === "viewer@exemple.cat");
  const admin = created.find((u) => u.email === "admin@exemple.cat");
  if (!editor || !viewer || !admin) throw new Error("usuaris");

  await db.insert(userLedgerPermissions).values([
    { userId: editor.id, ledgerId: personalId, role: "editor" },
    { userId: viewer.id, ledgerId: personalId, role: "viewer" },
    { userId: admin.id, ledgerId: personalId, role: "editor" },
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

  const accountList = await db
    .insert(accounts)
    .values([
      {
        connectionId: connection?.id ?? 0,
        ledgerId: personalId,
        ebAccountUid: "uid-p",
        name: "Personal",
        product: "",
        iban: "ES00",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      },
      {
        connectionId: connection?.id ?? 0,
        ledgerId: calellaId,
        ebAccountUid: "uid-c",
        name: "Calella",
        product: "",
        iban: "ES01",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      },
    ])
    .returning();
  accountPersonal = accountList.find((a) => a.ledgerId === personalId)?.id ?? 0;
  accountCalella = accountList.find((a) => a.ledgerId === calellaId)?.id ?? 0;

  const inserted = await db
    .insert(transactions)
    .values([
      {
        accountId: accountPersonal,
        ledgerId: personalId,
        dedupKey: "k-p-1",
        source: "manual",
        bookingDate: "2026-02-10",
        amount: "-100.00",
        currency: "EUR",
        status: "booked",
        description: "Floristeria",
        normalizedDescription: "FLORISTERIA",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: accountPersonal,
        ledgerId: personalId,
        dedupKey: "k-p-2",
        source: "manual",
        bookingDate: "2026-02-11",
        amount: "-50.00",
        currency: "EUR",
        status: "booked",
        description: "Restaurant",
        normalizedDescription: "RESTAURANT",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: accountPersonal,
        ledgerId: personalId,
        dedupKey: "k-p-3",
        source: "manual",
        bookingDate: "2026-02-12",
        amount: "20.00",
        currency: "EUR",
        status: "booked",
        description: "Regal rebut",
        normalizedDescription: "REGAL",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: accountCalella,
        ledgerId: calellaId,
        dedupKey: "k-c-1",
        source: "manual",
        bookingDate: "2026-02-10",
        amount: "-9.00",
        currency: "EUR",
        status: "booked",
        description: "De Calella",
        normalizedDescription: "CALELLA",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
    ])
    .returning();

  transactionPersonal = inserted.find((m) => m.dedupKey === "k-p-1")?.id ?? 0;
  transactionCalella = inserted.find((m) => m.dedupKey === "k-c-1")?.id ?? 0;

  editorSession = await signIn("editor@exemple.cat");
  viewerSession = await signIn("viewer@exemple.cat");
  adminSession = await signIn("admin@exemple.cat");
});

describe("normalizeTag", () => {
  test("trims and collapses spaces", () => {
    expect(normalizeTag("  casament  ")).toBe("casament");
    expect(normalizeTag("projecte   X")).toBe("projecte X");
  });

  test("rejects commas and empties", () => {
    expect(() => normalizeTag("a,b")).toThrow();
    expect(() => normalizeTag("   ")).toThrow();
  });

  test("compares case-insensitively", () => {
    expect(sameTag("Casament", "casament")).toBe(true);
  });
});

describe("tag service", () => {
  test("adds to and removes from a transaction", async () => {
    await addTag(transactionPersonal, personalId, "casament");
    const [row] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, transactionPersonal));
    expect(row?.tags).toEqual(["casament"]);

    await removeTag(transactionPersonal, personalId, "Casament");
    const [after] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, transactionPersonal));
    expect(after?.tags).toEqual([]);
  });

  test("does not duplicate when only the case changes", async () => {
    await addTag(transactionPersonal, personalId, "casament");
    await addTag(transactionPersonal, personalId, "Casament");
    const [row] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, transactionPersonal));
    expect(row?.tags).toEqual(["casament"]);
  });

  test("sums income and expenses with Decimal", async () => {
    const second = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-2"))
    )[0]?.id;
    const third = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-3"))
    )[0]?.id;
    if (!second || !third) throw new Error("falten moviments");

    await addTag(transactionPersonal, personalId, "casament");
    await addTag(second, personalId, "casament");
    await addTag(third, personalId, "casament");

    const list = await listTags(personalId);
    const wedding = list.find((e) => e.name === "casament");
    expect(wedding).toBeDefined();
    expect(wedding?.transactionCount).toBe(3);
    expect(wedding?.expenses).toBe("150.00");
    expect(wedding?.income).toBe("20.00");
    expect(wedding?.net).toBe("-130.00");
    // No parseFloat: the net is the exact subtraction with Decimal.
    expect(
      money(wedding?.income ?? "0")
        .minus(money(wedding?.expenses ?? "0"))
        .toFixed(2),
    ).toBe("-130.00");
  });

  test("deletes from the whole workspace", async () => {
    const second = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-2"))
    )[0]?.id;
    if (!second) throw new Error("falta");
    await addTag(transactionPersonal, personalId, "casament");
    await addTag(second, personalId, "casament");
    const howManyOf = await deleteTagFromWorkspace(personalId, "Casament");
    expect(howManyOf).toBe(2);
    expect(await listTags(personalId)).toEqual([]);
  });
});

describe("tag routes", () => {
  test("adds from the row", async () => {
    const res = await send(`/e/personal/moviments/${transactionPersonal}/etiquetes`, {
      nova_etiqueta: "casament",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("casament");
    expect(html).toContain(`id="moviment-${transactionPersonal}"`);
  });

  test("the page and the fragment are not the same URL", async () => {
    await addTag(transactionPersonal, personalId, "casament");

    const page = await app.request("/e/personal/etiquetes/casament", {
      headers: { Cookie: adminSession.cookie },
    });
    const fragment = await app.request("/e/personal/etiquetes/casament/fragment/taula", {
      headers: { Cookie: adminSession.cookie },
    });

    expect(page.status).toBe(200);
    expect(fragment.status).toBe(200);
    const pageHtml = await page.text();
    const htmlFragment = await fragment.text();
    expect(pageHtml).toContain("<!doctype html>");
    expect(htmlFragment).not.toContain("<!doctype html>");
    expect(htmlFragment).toContain('id="taula-etiqueta"');
  });

  test("the index shows the total", async () => {
    await addTag(transactionPersonal, personalId, "casament");
    const res = await app.request("/e/personal/etiquetes", {
      headers: { Cookie: adminSession.cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("casament");
    expect(html).toContain("100,00");
  });

  test("a non-administrator does not see the tag pages", async () => {
    const res = await app.request("/e/personal/etiquetes", {
      headers: { Cookie: editorSession.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("a viewer cannot mutate", async () => {
    const res = await send(
      `/e/personal/moviments/${transactionPersonal}/etiquetes`,
      { nova_etiqueta: "casament" },
      viewerSession,
    );
    expect(res.status).toBe(403);
  });

  test("a transaction of another workspace cannot be tagged", async () => {
    const res = await send(`/e/personal/moviments/${transactionCalella}/etiquetes`, {
      nova_etiqueta: "casament",
    });
    expect(res.status).toBe(404);
  });
});
