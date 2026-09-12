/**
 * Pairing of transfers between the owner's own accounts.
 *
 * This decides what counts as income and what does not, so when it gets it
 * wrong the error shows up in the reports and not on screen. The two
 * invariants that matter:
 *
 *   1. **Both legs, or neither.** A half pair takes the debit out of the
 *      reports and leaves the credit counting: the month comes out wrong by
 *      the whole amount, and it looks right.
 *   2. **A transaction excluded by hand enters no pair**, because pairing it
 *      would take the other leg out of the reports without anyone asking.
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
  rules,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { seedCategories } from "../src/services/seed.ts";
import { detectTransfers } from "../src/services/transfers.ts";

const Today = new Date().toISOString().slice(0, 10);

function fewerDays(days: number): string {
  const d = new Date(`${Today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

let ledgerId = 0;
let accountA = 0;
let accountB = 0;

interface TransactionOptions {
  account: number;
  amount: string;
  day?: string;
  categorySource?: "none" | "user" | "rule" | "merchant" | "llm";
  categoryId?: number | null;
  isExcluded?: boolean;
  key?: string;
}

async function transaction(o: TransactionOptions): Promise<number> {
  const day = o.day ?? fewerDays(5);
  const [row] = await db
    .insert(transactions)
    .values({
      accountId: o.account,
      ledgerId,
      dedupKey: o.key ?? `k-${o.account}-${o.amount}-${day}-${Math.random()}`,
      source: "enablebanking",
      bookingDate: day,
      amount: o.amount,
      currency: "EUR",
      status: "booked",
      description: "Traspas",
      normalizedDescription: "TRASPAS",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: null,
      categoryId: o.categoryId ?? null,
      categorySource: o.categorySource ?? "none",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: o.isExcluded ?? false,
      raw: {},
    })
    .returning();
  return row?.id ?? 0;
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
        ledgerId,
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

describe("what gets paired", () => {
  test("an equal debit and credit from different accounts", async () => {
    const debit = await transaction({ account: accountA, amount: "-400.00" });
    const signIn = await transaction({ account: accountB, amount: "400.00" });

    expect(await detectTransfers(ledgerId)).toBe(1);

    const a = await read(debit);
    const b = await read(signIn);
    expect(a.transferGroupId).not.toBeNull();
    expect(a.transferGroupId).toBe(b.transferGroupId);
  });

  test("nothing from the same account is paired", async () => {
    await transaction({ account: accountA, amount: "-400.00" });
    await transaction({ account: accountA, amount: "400.00" });

    expect(await detectTransfers(ledgerId)).toBe(0);
  });

  test("nor with more than three days in between", async () => {
    await transaction({ account: accountA, amount: "-400.00", day: fewerDays(10) });
    await transaction({ account: accountB, amount: "400.00", day: fewerDays(1) });

    expect(await detectTransfers(ledgerId)).toBe(0);
  });

  test("nor with different amounts", async () => {
    await transaction({ account: accountA, amount: "-400.00" });
    await transaction({ account: accountB, amount: "399.00" });

    expect(await detectTransfers(ledgerId)).toBe(0);
  });

  test("one that already has a group is not looked at again", async () => {
    await transaction({ account: accountA, amount: "-400.00" });
    await transaction({ account: accountB, amount: "400.00" });
    await detectTransfers(ledgerId);

    expect(await detectTransfers(ledgerId)).toBe(0);
  });
});

describe("an excluded transaction", () => {
  test("enters no pair", async () => {
    const debit = await transaction({ account: accountA, amount: "-400.00", isExcluded: true });
    const signIn = await transaction({ account: accountB, amount: "400.00" });

    expect(await detectTransfers(ledgerId)).toBe(0);
    // And, above all, the other leg keeps counting in the reports.
    expect((await read(signIn)).transferGroupId).toBeNull();
    expect((await read(debit)).transferGroupId).toBeNull();
  });
});

describe("the category", () => {
  test("the transfer sets it if nobody has chosen one", async () => {
    const debit = await transaction({ account: accountA, amount: "-400.00" });
    await transaction({ account: accountB, amount: "400.00" });

    await detectTransfers(ledgerId);

    const a = await read(debit);
    expect(a.categorySource).toBe("rule");
    expect(a.categoryId).not.toBeNull();
  });

  test("but it does not touch the one a person set", async () => {
    const [own] = await db
      .select()
      .from(categories)
      .where(
        and(eq(categories.ledgerId, ledgerId), eq(categories.slug, "alimentacio-supermercat")),
      )
      .limit(1);

    const debit = await transaction({
      account: accountA,
      amount: "-400.00",
      categorySource: "user",
      categoryId: own?.id ?? null,
    });
    await transaction({ account: accountB, amount: "400.00" });

    await detectTransfers(ledgerId);

    const a = await read(debit);
    expect(a.categoryId).toBe(own?.id ?? 0);
    expect(a.categorySource).toBe("user");
    // But it does end up paired.
    expect(a.transferGroupId).not.toBeNull();
  });
});

describe("both legs, or neither", () => {
  test("if the second write fails, neither is left labelled", async () => {
    const debit = await transaction({ account: accountA, amount: "-400.00" });
    const signIn = await transaction({ account: accountB, amount: "400.00" });

    // A trigger that blows up the write of one of the two legs. It is the way
    // to really reach the case the transaction has to cover.
    await db.execute(sql`
      create or replace function peta_una_cama() returns trigger as $$
      begin
        if new.transfer_group_id is not null and new.amount > 0 then
          raise exception 'peta a posta';
        end if;
        return new;
      end $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger peta_una_cama before update on transactions
      for each row execute function peta_una_cama()
    `);

    try {
      await expect(detectTransfers(ledgerId)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists peta_una_cama on transactions`);
      await db.execute(sql`drop function if exists peta_una_cama()`);
    }

    // Neither of the two was marked: without the transaction, the debit would
    // have been left with a group and the credit without one.
    expect((await read(debit)).transferGroupId).toBeNull();
    expect((await read(signIn)).transferGroupId).toBeNull();
  });
});

/**
 * A rule's match counter.
 *
 * It is raised with `match_count + 1` **in the database**. If it were done
 * from the value read in JavaScript, two passes at once —the night's
 * synchronization and somebody applying a rule by hand— would tread on each
 * other and the counter would go backwards.
 */
describe("a rule's counter", () => {
  test("nothing is lost even when two passes write to it at once", async () => {
    const [rule] = await db
      .insert(rules)
      .values({
        ledgerId,
        name: "prova",
        priority: 10,
        isActive: true,
        source: "user",
        conditions: [],
        setCategoryId: null,
        setMerchantId: null,
        setTags: [],
        matchCount: 0,
      })
      .returning();
    const id = rule?.id ?? 0;

    // Twenty increments at once, each on its own connection.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        db
          .update(rules)
          .set({ matchCount: sql`${rules.matchCount} + 1` })
          .where(eq(rules.id, id)),
      ),
    );

    const [final] = await db.select().from(rules).where(eq(rules.id, id));
    expect(final?.matchCount).toBe(20);
  });
});
