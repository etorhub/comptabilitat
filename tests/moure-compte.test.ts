/**
 * Moure un compte d'espai.
 *
 * Toca l'historial sencer del compte, aixi que el que s'hi perd no es recupera.
 * Les tres coses que han de valer:
 *
 *   1. **El que ha triat una persona es conserva.** Els identificadors de
 *      categoria son de cada espai, pero el slug vol dir el mateix a tots, i
 *      tots es sembren amb el mateix pla.
 *   2. **La cama que es queda no es queda orfe.** Si l'altra meitat d'un
 *      traspas se'n va, la que resta ha de tornar a comptar als informes.
 *   3. **O tot, o res.** Si peta a mitges, el compte no pot quedar mig mogut.
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
  descripcio?: string;
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
      description: o.descripcio ?? "COMPRA EN MERCADONA",
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

describe("el que ha triat una persona", () => {
  test("es conserva a l'altre espai, lligat pel slug", async () => {
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

  test("i el que havia posat una regla, no", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "rule" });

    const summary = await moveAccountToWorkspace(accountA, calellaId);

    expect(summary.conservades).toBe(0);
    // Se'n va a la safata: a l'espai nou hi manen les seves regles.
    expect((await read(id)).categorySource).not.toBe("user");
  });

  test("si la categoria nomes existia a l'espai vell, va a revisar", async () => {
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

describe("els traspassos de l'espai que es deixa", () => {
  test("la cama que es queda torna a comptar", async () => {
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
    // La que es queda ja no apunta a un aparellament que no existeix, aixi que
    // torna a sortir als informes de Personal.
    expect((await read(altra)).transferGroupId).toBeNull();
    expect((await read(seva)).transferGroupId).toBeNull();
  });
});

describe("o tot, o res", () => {
  test("si peta a mitges, el compte no queda mig mogut", async () => {
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

    // Res no s'ha mogut: ni el compte, ni el moviment, ni la seva categoria.
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountA));
    expect(account?.ledgerId).toBe(personalId);
    const row = await read(id);
    expect(row.ledgerId).toBe(personalId);
    expect(row.categoryId).toBe(origin.id);
    expect(row.categorySource).toBe("user");
  });
});

describe("treure el compte de tot espai", () => {
  test("deixa els moviments sense espai i sense classificar", async () => {
    const origin = await category(personalId, "alimentacio-supermercat");
    const id = await transaction({ categoryId: origin.id, categorySource: "user" });

    await moveAccountToWorkspace(accountA, null);

    const row = await read(id);
    expect(row.ledgerId).toBeNull();
    expect(row.categoryId).toBeNull();
  });
});
