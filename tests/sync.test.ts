/**
 * Transaction import.
 *
 * A translation of `backend/tests/test_sync.py`. It is tested against a fake
 * Enable Banking client, as the Python did with recorded responses: the suite
 * touches no external service.
 *
 * The case that matters most is the reconciliation: when a **pending** entry
 * is booked, it must not be duplicated, and whatever category a person set
 * has to be kept.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  alerts,
  balances,
  bankConnections,
  categories,
  ledgers,
  merchants,
  syncRuns,
  transactions,
  type Account,
  type BankConnection,
} from "../src/db/schema/index.ts";
import { seedCategories } from "../src/services/seed.ts";
import { dedupKey, parseTransaction } from "../src/lib/enablebanking/parsing.ts";

let workspaceId = 0;
let connection: BankConnection;
let account: Account;

/** A transaction as the bank returns it. */
function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "BOOK",
    transaction_amount: { amount: "45.20", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    booking_date: "2026-03-01",
    creditor: { name: "Mercadona S.A." },
    remittance_information: ["COMPRA TARJ MERCADONA"],
    ...over,
  };
}

/**
 * Inserts transactions the way the import would.
 *
 * `sincronitzaConnection` is not called because that would need a network;
 * what is tested is the part that decides, which is `saveTransactions`,
 * through its effect on the database.
 */
async function importa(
  items: Record<string, unknown>[],
  llistaIncompleta = false,
): Promise<void> {
  const { saveTransactions } = await import("../src/services/import.ts");
  const analitzats = items
    .map(parseTransaction)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  await saveTransactions(account, analitzats, llistaIncompleta);
}

beforeEach(async () => {
  await db.delete(syncRuns);
  await db.delete(transactions);
  await db.delete(balances);
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
  workspaceId = workspace?.id ?? 0;
  await seedCategories(workspaceId);

  const [con] = await db
    .insert(bankConnections)
    .values({
      name: "Santander",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      ebSessionId: "sess-1",
      status: "active",
      lastError: "",
    })
    .returning();
  connection = con as BankConnection;

  const [acc] = await db
    .insert(accounts)
    .values({
      connectionId: connection.id,
      ledgerId: workspaceId,
      ebAccountUid: "uid-sync",
      name: "Compte",
      product: "",
      iban: "ES9121000418450200051332",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  account = acc as Account;
});

describe("importar", () => {
  test("desa els moviments nous", async () => {
    await importa([raw(), raw({ entry_reference: "R2", booking_date: "2026-03-02" })]);
    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(2);
  });

  test("no els duplica si es torna a importar el mateix", async () => {
    const items = [raw({ entry_reference: "R1" }), raw({ entry_reference: "R2" })];
    await importa(items);
    await importa(items);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  test("els classifica i els dona un comerç", async () => {
    await importa([raw({ entry_reference: "R1" })]);
    const [t] = await db.select().from(transactions);

    // The dot inside the acronym stays; the final one goes. It is what the
    // Python does and what is stored in `merchants.normalized_name`.
    expect(t?.normalizedDescription).toBe("MERCADONA S.A");
    expect(t?.merchantId).not.toBeNull();

    const [merchant] = await db.select().from(merchants);
    expect(merchant?.ledgerId).toBe(workspaceId);
    expect(merchant?.displayName).toBe("Mercadona S.A");
  });

  test("apunta fins on ha arribat l'historic", async () => {
    await importa([
      raw({ entry_reference: "R1", booking_date: "2026-01-15" }),
      raw({ entry_reference: "R2", booking_date: "2026-03-20" }),
    ]);
    const [actualitzat] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(actualitzat?.historyStartDate).toBe("2026-01-15");
    expect(actualitzat?.lastBookedDate).toBe("2026-03-20");
  });
});

describe("un apunt pendent que es consolida", () => {
  test("no es duplica: es reaprofita la fila", async () => {
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    // The same amount, two days later and already booked.
    await importa([
      raw({ status: "BOOK", booking_date: "2026-03-03", entry_reference: "R-DEF" }),
    ]);

    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(1);
    expect(desats[0]?.status).toBe("booked");
    expect(desats[0]?.entryReference).toBe("R-DEF");
  });

  test("i conserva la categoria que hi havia posat una persona", async () => {
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);

    const [category] = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.ledgerId, workspaceId),
          eq(categories.slug, "alimentacio-supermercat"),
        ),
      )
      .limit(1);

    await db
      .update(transactions)
      .set({ categoryId: category?.id, categorySource: "user", needsReview: false })
      .where(eq(transactions.accountId, account.id));

    await importa([
      raw({ status: "BOOK", booking_date: "2026-03-03", entry_reference: "R-DEF" }),
    ]);

    const [t] = await db.select().from(transactions);
    expect(t?.categoryId).toBe(category?.id ?? 0);
    expect(t?.categorySource).toBe("user");
  });

  test("massa lluny en el temps, no s'aparella", async () => {
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);
    // Nine days later: outside the five-day window.
    await importa([
      raw({ status: "BOOK", booking_date: "2026-03-10", entry_reference: "R-LLUNY" }),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  test("amb un import diferent, tampoc", async () => {
    const pendent = raw({ status: "PDNG", booking_date: "2026-03-01" });
    await importa([pendent]);

    // The bank keeps reporting the pending one and, on top of that, a new
    // entry of a different amount. As they do not match, they must not be paired.
    await importa([
      pendent,
      raw({
        status: "BOOK",
        booking_date: "2026-03-02",
        entry_reference: "R-ALTRE",
        transaction_amount: { amount: "99.99", currency: "EUR" },
      }),
    ]);

    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(2);
    expect(desats.filter((t) => t.status === "pending")).toHaveLength(1);
  });

  test("un pendent que el banc deixa de reportar desapareix", async () => {
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    // Now the bank only reports an entry of a different amount: the pending
    // one that is no longer there is deleted, as the Python did.
    await importa([
      raw({
        status: "BOOK",
        booking_date: "2026-03-02",
        entry_reference: "R-ALTRE",
        transaction_amount: { amount: "99.99", currency: "EUR" },
      }),
    ]);

    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(1);
    expect(desats[0]?.entryReference).toBe("R-ALTRE");
  });

  test("pero no si la llista del banc ve escapçada", async () => {
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    // The same case as before, but the bank hit the page limit: «it is not
    // there» means «it did not arrive», and deleting it would really lose it
    // along with any notes and category it had.
    await importa(
      [
        raw({
          status: "BOOK",
          booking_date: "2026-03-02",
          entry_reference: "R-ALTRE",
          transaction_amount: { amount: "99.99", currency: "EUR" },
        }),
      ],
      true,
    );

    expect(await db.select().from(transactions)).toHaveLength(2);
  });
});

describe("els pendents que el banc ja no reporta", () => {
  test("s'esborren", async () => {
    await importa([
      raw({ status: "PDNG", booking_date: "2026-03-01" }),
      raw({
        status: "PDNG",
        booking_date: "2026-03-01",
        transaction_amount: { amount: "7.00", currency: "EUR" },
      }),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(2);

    // The second time the bank only reports one.
    await importa([raw({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });
});

describe("el que el banc canvia d'un moviment que ja teniem", () => {
  test("s'actualitza sense duplicar", async () => {
    await importa([raw({ entry_reference: "R1", booking_date: "2026-03-01" })]);
    await importa([
      raw({
        entry_reference: "R1",
        booking_date: "2026-03-01",
        transaction_amount: { amount: "50.00", currency: "EUR" },
      }),
    ]);

    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(1);
    expect(desats[0]?.amount).toBe("-50.00");
  });
});

describe("la clau de deduplicacio", () => {
  test("la que es desa es la que calcula el parser", async () => {
    const item = raw({ entry_reference: "R-CLAU" });
    await importa([item]);
    const analyzed = parseTransaction(item);
    const [t] = await db.select().from(transactions);
    expect(t?.dedupKey).toBe(dedupKey(analyzed as NonNullable<typeof analyzed>));
  });
});
