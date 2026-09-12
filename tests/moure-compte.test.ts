/**
 * Moving an account between workspaces.
 *
 * It touches the account's whole history, so what is lost there is not
 * recovered. The three things that have to hold:
 *
 *   1. **What a person chose is kept.** Category ids belong to each
 *      workspace, but the slug means the same in all of them, and they are
 *      all seeded with the same plan.
 *   2. **The leg that stays is not left orphaned.** If the other half of a
 *      transfer leaves, the remaining one has to count in the reports again.
 *   3. **All or nothing.** If it fails halfway, the account cannot be left half-moved.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

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
import { moveAccountToWorkspace } from "../src/services/accounts.ts";
import { seedCategories } from "../src/services/seed.ts";

let personalId = 0;
let calellaId = 0;
let accountA = 0;
let accountB = 0;

async function category(ledgerId: number, slug: string) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta ${slug}`);
  return c;
}

interface TransactionOptions {
  account?: number;
  ledgerId?: number;
  amount?: string;
  description?: string;
  categoryId?: number | null;
  categorySource?: "none" | "user" | "rule" | "merchant" | "llm";
  transferGroupId?: string | null;
}

async function transaction(o: TransactionOptions = {}): Promise<number> {
  const [f] = await db
    .insert(transactions)
    .values({
      accountId: o.account ?? accountA,
      ledgerId: o.ledgerId ?? personalId,
      dedupKey: `k-${Math.random()}`,
      source: "enablebanking",
      bookingDate: "2026-02-10",
      amount: o.amount ?? "-30.00",
      currency: "EUR",
      status: "booked",
      description: o.description ?? "COMPRA EN MERCADONA",
      normalizedDescription: "MERCADONA",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: null,
      categoryId: o.categoryId ?? null,
      categorySource: o.categorySource ?? "none",
      categoryConfidence: null,
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      transferGroupId: o.transferGroupId ?? null,
      raw: {},
    })
    .returning();
  return f?.id ?? 0;
}

async function read(id: number) {
  const [f] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!f) throw new Error("ha desaparegut");
  return f;
}

beforeEach(async () => {
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
      ["uid-a", "uid-b"].map((uid) => ({
        connectionId: connection?.id ?? 0,
        ledgerId: personalId,
        ebAccountUid: uid,
        name: uid,
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
  accountA = accountList.find((c) => c.ebAccountUid === "uid-a")?.id ?? 0;
  accountB = accountList.find((c) => c.ebAccountUid === "uid-b")?.id ?? 0;
});

describe("what a person chose", () => {
  test("is kept in the other workspace, linked by slug", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "user" });

    const summary = await moveAccountToWorkspace(accountA, calellaId);

    expect(summary.conservades).toBe(1);
    const desti = await category(calellaId, "alimentacio-supermercat");
    const row = await read(id);
    expect(row.ledgerId).toBe(calellaId);
    expect(row.categoryId).toBe(desti.id);
    expect(row.categorySource).toBe("user");
    expect(row.needsReview).toBe(false);
  });

  test("and what a rule had set is not", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "rule" });

    const summary = await moveAccountToWorkspace(accountA, calellaId);

    expect(summary.conservades).toBe(0);
    // It goes to the tray: in the new workspace its own rules apply.
    expect((await read(id)).categorySource).not.toBe("user");
  });

  test("if the category only existed in the old workspace, it goes to review", async () => {
    const [propia] = await db
      .insert(categories)
      .values({
        ledgerId: personalId,
        parentId: null,
        slug: "nomes-meva",
        name: "Nomes meva",
        kind: "expense",
        color: "#000000",
        icon: "",
        isSystem: false,
        position: 99,
      })
      .returning();
    const id = await transaction({ categoryId: propia?.id ?? 0, categorySource: "user" });

    const summary = await moveAccountToWorkspace(accountA, calellaId);

    expect(summary.conservades).toBe(0);
    expect((await read(id)).needsReview).toBe(true);
  });
});

describe("the transfers of the workspace being left", () => {
  test("the leg that stays counts again", async () => {
    const group = "g".repeat(32);
    const seva = await transaction({
      account: accountA,
      amount: "-400.00",
      transferGroupId: group,
    });
    const altra = await transaction({
      account: accountB,
      amount: "400.00",
      transferGroupId: group,
    });

    const summary = await moveAccountToWorkspace(accountA, calellaId);

    expect(summary.undoneTransfers).toBe(1);
    // The one that stays no longer points at a pairing that does not exist, so
    // it shows up in Personal's reports again.
    expect((await read(altra)).transferGroupId).toBeNull();
    expect((await read(seva)).transferGroupId).toBeNull();
  });
});

describe("all or nothing", () => {
  test("if it fails halfway, the account is not left half-moved", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "user" });

    await db.execute(sql`
      create or replace function peta_el_trasllat() returns trigger as $$
      begin raise exception 'peta a posta'; end $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger peta_el_trasllat before insert on merchants
      for each row execute function peta_el_trasllat()
    `);

    try {
      await expect(moveAccountToWorkspace(accountA, calellaId)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists peta_el_trasllat on merchants`);
      await db.execute(sql`drop function if exists peta_el_trasllat()`);
    }

    // Nothing has moved: not the account, not the transaction, not its category.
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountA));
    expect(account?.ledgerId).toBe(personalId);
    const row = await read(id);
    expect(row.ledgerId).toBe(personalId);
    expect(row.categoryId).toBe(origin.id);
    expect(row.categorySource).toBe("user");
  });
});

describe("taking the account out of every workspace", () => {
  test("leaves the transactions with no workspace and unclassified", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "user" });

    await moveAccountToWorkspace(accountA, null);

    const row = await read(id);
    expect(row.ledgerId).toBeNull();
    expect(row.categoryId).toBeNull();
  });
});
