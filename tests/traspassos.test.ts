/**
 * Aparellament de traspassos entre comptes propis.
 *
 * Aixo decideix que compta com a ingres i que no, aixi que quan s'equivoca
 * l'error surt als informes i no a la pantalla. Les dues invariants que
 * importen:
 *
 *   1. **Les dues cames, o cap.** Una parella a mitges treu la sortida dels
 *      informes i deixa l'entrada comptant: el mes surt malament per l'import
 *      sencer, i sembla correcte.
 *   2. **Un moviment exclos a ma no entra en cap parella**, perque aparellar-lo
 *      trauria l'altra cama dels informes sense que ningu ho hagues demanat.
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
import { seedCategories } from "../src/services/seed.ts";
import { detectaTraspassos } from "../src/services/transfers.ts";

const AVUI = new Date().toISOString().slice(0, 10);

function menysDies(dies: number): string {
  const d = new Date(`${AVUI}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dies);
  return d.toISOString().slice(0, 10);
}

let ledgerId = 0;
let compteA = 0;
let compteB = 0;

interface OpcionsMoviment {
  compte: number;
  amount: string;
  dia?: string;
  categorySource?: "none" | "user" | "rule" | "merchant" | "llm";
  categoryId?: number | null;
  isExcluded?: boolean;
  clau?: string;
}

async function moviment(o: OpcionsMoviment): Promise<number> {
  const dia = o.dia ?? menysDies(5);
  const [fila] = await db
    .insert(transactions)
    .values({
      accountId: o.compte,
      ledgerId,
      dedupKey: o.clau ?? `k-${o.compte}-${o.amount}-${dia}-${Math.random()}`,
      source: "enablebanking",
      bookingDate: dia,
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
  return fila?.id ?? 0;
}

async function llegeix(id: number) {
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
  ledgerId = espai?.id ?? 0;
  await seedCategories(ledgerId);

  const [connexio] = await db
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

  const comptes = await db
    .insert(accounts)
    .values(
      ["uid-a", "uid-b"].map((uid) => ({
        connectionId: connexio?.id ?? 0,
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
  compteA = comptes.find((c) => c.ebAccountUid === "uid-a")?.id ?? 0;
  compteB = comptes.find((c) => c.ebAccountUid === "uid-b")?.id ?? 0;
});

describe("que s'aparella", () => {
  test("una sortida i una entrada iguals de comptes diferents", async () => {
    const surt = await moviment({ compte: compteA, amount: "-400.00" });
    const entra = await moviment({ compte: compteB, amount: "400.00" });

    expect(await detectaTraspassos(ledgerId)).toBe(1);

    const a = await llegeix(surt);
    const b = await llegeix(entra);
    expect(a.transferGroupId).not.toBeNull();
    expect(a.transferGroupId).toBe(b.transferGroupId);
  });

  test("no s'aparella res del mateix compte", async () => {
    await moviment({ compte: compteA, amount: "-400.00" });
    await moviment({ compte: compteA, amount: "400.00" });

    expect(await detectaTraspassos(ledgerId)).toBe(0);
  });

  test("ni amb mes de tres dies pel mig", async () => {
    await moviment({ compte: compteA, amount: "-400.00", dia: menysDies(10) });
    await moviment({ compte: compteB, amount: "400.00", dia: menysDies(1) });

    expect(await detectaTraspassos(ledgerId)).toBe(0);
  });

  test("ni amb imports diferents", async () => {
    await moviment({ compte: compteA, amount: "-400.00" });
    await moviment({ compte: compteB, amount: "399.00" });

    expect(await detectaTraspassos(ledgerId)).toBe(0);
  });

  test("el que ja te grup no es torna a mirar", async () => {
    await moviment({ compte: compteA, amount: "-400.00" });
    await moviment({ compte: compteB, amount: "400.00" });
    await detectaTraspassos(ledgerId);

    expect(await detectaTraspassos(ledgerId)).toBe(0);
  });
});

describe("un moviment exclos", () => {
  test("no entra en cap parella", async () => {
    const surt = await moviment({ compte: compteA, amount: "-400.00", isExcluded: true });
    const entra = await moviment({ compte: compteB, amount: "400.00" });

    expect(await detectaTraspassos(ledgerId)).toBe(0);
    // I, sobretot, l'altra cama continua comptant als informes.
    expect((await llegeix(entra)).transferGroupId).toBeNull();
    expect((await llegeix(surt)).transferGroupId).toBeNull();
  });
});

describe("la categoria", () => {
  test("la posa el traspas si no l'ha triada ningu", async () => {
    const surt = await moviment({ compte: compteA, amount: "-400.00" });
    await moviment({ compte: compteB, amount: "400.00" });

    await detectaTraspassos(ledgerId);

    const a = await llegeix(surt);
    expect(a.categorySource).toBe("rule");
    expect(a.categoryId).not.toBeNull();
  });

  test("pero no toca la que ha posat una persona", async () => {
    const [propia] = await db
      .select()
      .from(categories)
      .where(
        and(eq(categories.ledgerId, ledgerId), eq(categories.slug, "alimentacio-supermercat")),
      )
      .limit(1);

    const surt = await moviment({
      compte: compteA,
      amount: "-400.00",
      categorySource: "user",
      categoryId: propia?.id ?? null,
    });
    await moviment({ compte: compteB, amount: "400.00" });

    await detectaTraspassos(ledgerId);

    const a = await llegeix(surt);
    expect(a.categoryId).toBe(propia?.id ?? 0);
    expect(a.categorySource).toBe("user");
    // Pero si que queda aparellat.
    expect(a.transferGroupId).not.toBeNull();
  });
});

describe("les dues cames, o cap", () => {
  test("si la segona escriptura peta, no en queda cap d'etiquetada", async () => {
    const surt = await moviment({ compte: compteA, amount: "-400.00" });
    const entra = await moviment({ compte: compteB, amount: "400.00" });

    // Un disparador que fa petar l'escriptura d'una de les dues cames. Es la
    // manera d'arribar de debo al cas que la transaccio ha de cobrir.
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
      await expect(detectaTraspassos(ledgerId)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists peta_una_cama on transactions`);
      await db.execute(sql`drop function if exists peta_una_cama()`);
    }

    // Cap de les dues no ha quedat marcada: sense la transaccio, la sortida
    // hauria quedat amb grup i l'entrada sense.
    expect((await llegeix(surt)).transferGroupId).toBeNull();
    expect((await llegeix(entra)).transferGroupId).toBeNull();
  });
});
