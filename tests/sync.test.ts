/**
 * Importacio de moviments.
 *
 * Traduccio de `backend/tests/test_sync.py`. Es prova contra un client
 * d'Enable Banking de mentida, com feia el Python amb respostes gravades: la
 * bateria no toca cap servei extern.
 *
 * El cas que mes importa es el de la reconciliacio: quan un apunt **pendent**
 * es consolida, no ha de duplicar-se, i la categoria que hi hagi posat una
 * persona s'ha de conservar.
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

let espaiId = 0;
let connexio: BankConnection;
let compte: Account;

/** Un moviment tal com el torna el banc. */
function crua(over: Record<string, unknown> = {}): Record<string, unknown> {
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
 * Insereix moviments com ho faria la importacio.
 *
 * No es crida `sincronitzaConnexio` perque aixo demanaria una xarxa; el que
 * es prova es la part que decideix, que es `desaMoviments`, a traves del seu
 * efecte a la base de dades.
 */
async function importa(items: Record<string, unknown>[]): Promise<void> {
  const { desaMovimentsPerAProves } = await import("../src/services/sync.ts");
  const analitzats = items
    .map(parseTransaction)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  await desaMovimentsPerAProves(compte, analitzats);
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

  const [espai] = await db
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
  espaiId = espai?.id ?? 0;
  await seedCategories(espaiId);

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
  connexio = con as BankConnection;

  const [acc] = await db
    .insert(accounts)
    .values({
      connectionId: connexio.id,
      ledgerId: espaiId,
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
  compte = acc as Account;
});

describe("importar", () => {
  test("desa els moviments nous", async () => {
    await importa([crua(), crua({ entry_reference: "R2", booking_date: "2026-03-02" })]);
    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(2);
  });

  test("no els duplica si es torna a importar el mateix", async () => {
    const items = [crua({ entry_reference: "R1" }), crua({ entry_reference: "R2" })];
    await importa(items);
    await importa(items);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  test("els classifica i els dona un comerç", async () => {
    await importa([crua({ entry_reference: "R1" })]);
    const [t] = await db.select().from(transactions);

    // El punt de dins de la sigla es queda; el final se'n va. Es el que fa
    // el Python i el que hi ha desat a `merchants.normalized_name`.
    expect(t?.normalizedDescription).toBe("MERCADONA S.A");
    expect(t?.merchantId).not.toBeNull();

    const [comerc] = await db.select().from(merchants);
    expect(comerc?.ledgerId).toBe(espaiId);
    expect(comerc?.displayName).toBe("Mercadona S.A");
  });

  test("apunta fins on ha arribat l'historic", async () => {
    await importa([
      crua({ entry_reference: "R1", booking_date: "2026-01-15" }),
      crua({ entry_reference: "R2", booking_date: "2026-03-20" }),
    ]);
    const [actualitzat] = await db.select().from(accounts).where(eq(accounts.id, compte.id));
    expect(actualitzat?.historyStartDate).toBe("2026-01-15");
    expect(actualitzat?.lastBookedDate).toBe("2026-03-20");
  });
});

describe("un apunt pendent que es consolida", () => {
  test("no es duplica: es reaprofita la fila", async () => {
    await importa([crua({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    // El mateix import, dos dies mes tard i ja definitiu.
    await importa([
      crua({ status: "BOOK", booking_date: "2026-03-03", entry_reference: "R-DEF" }),
    ]);

    const desats = await db.select().from(transactions);
    expect(desats).toHaveLength(1);
    expect(desats[0]?.status).toBe("booked");
    expect(desats[0]?.entryReference).toBe("R-DEF");
  });

  test("i conserva la categoria que hi havia posat una persona", async () => {
    await importa([crua({ status: "PDNG", booking_date: "2026-03-01" })]);

    const [categoria] = await db
      .select()
      .from(categories)
      .where(
        and(eq(categories.ledgerId, espaiId), eq(categories.slug, "alimentacio-supermercat")),
      )
      .limit(1);

    await db
      .update(transactions)
      .set({ categoryId: categoria?.id, categorySource: "user", needsReview: false })
      .where(eq(transactions.accountId, compte.id));

    await importa([
      crua({ status: "BOOK", booking_date: "2026-03-03", entry_reference: "R-DEF" }),
    ]);

    const [t] = await db.select().from(transactions);
    expect(t?.categoryId).toBe(categoria?.id ?? 0);
    expect(t?.categorySource).toBe("user");
  });

  test("massa lluny en el temps, no s'aparella", async () => {
    await importa([crua({ status: "PDNG", booking_date: "2026-03-01" })]);
    // Nou dies despres: fora de la finestra de cinc.
    await importa([
      crua({ status: "BOOK", booking_date: "2026-03-10", entry_reference: "R-LLUNY" }),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  test("amb un import diferent, tampoc", async () => {
    const pendent = crua({ status: "PDNG", booking_date: "2026-03-01" });
    await importa([pendent]);

    // El banc continua reportant el pendent i, a mes, un apunt nou d'un altre
    // import. Com que no coincideixen, no s'han d'aparellar.
    await importa([
      pendent,
      crua({
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
    await importa([crua({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    // Ara el banc nomes reporta un apunt d'un altre import: el pendent que
    // ja no consta s'esborra, com feia el Python.
    await importa([
      crua({
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
});

describe("els pendents que el banc ja no reporta", () => {
  test("s'esborren", async () => {
    await importa([
      crua({ status: "PDNG", booking_date: "2026-03-01" }),
      crua({
        status: "PDNG",
        booking_date: "2026-03-01",
        transaction_amount: { amount: "7.00", currency: "EUR" },
      }),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(2);

    // La segona vegada el banc nomes en reporta un.
    await importa([crua({ status: "PDNG", booking_date: "2026-03-01" })]);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });
});

describe("el que el banc canvia d'un moviment que ja teniem", () => {
  test("s'actualitza sense duplicar", async () => {
    await importa([crua({ entry_reference: "R1", booking_date: "2026-03-01" })]);
    await importa([
      crua({
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
    const item = crua({ entry_reference: "R-CLAU" });
    await importa([item]);
    const analitzat = parseTransaction(item);
    const [t] = await db.select().from(transactions);
    expect(t?.dedupKey).toBe(dedupKey(analitzat as NonNullable<typeof analitzat>));
  });
});
