/**
 * Categories: el pla de dos nivells i l'esborrat amb reassignacio.
 *
 * Traduccio de `backend/tests/test_categories.py`. El cas important es el
 * 409: esborrar una categoria que te moviments no ha de perdre'ls mai.
 */

import { beforeAll, describe, expect, test } from "bun:test";
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
import { AppError, ConflictError } from "../src/lib/http.ts";
import {
  categoriaDeLespai,
  creaCategoria,
  esborraCategoria,
  opcionsCategories,
} from "../src/services/categories.ts";
import { seedCategories } from "../src/services/seed.ts";
import { SLUG_UNCATEGORIZED } from "../src/services/slugs.ts";
import { hashPassword } from "../src/lib/auth.ts";

let ledgerId = 0;
let altreLedgerId = 0;
let accountId = 0;

async function categoriaPerSlug(slug: string, ledger = ledgerId) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledger), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`no hi ha la categoria ${slug}`);
  return c;
}

beforeAll(async () => {
  await db.delete(transactions);
  await db.delete(rules);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const espais = await db
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

  ledgerId = espais.find((e) => e.code === "personal")?.id ?? 0;
  altreLedgerId = espais.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(ledgerId);
  await seedCategories(altreLedgerId);

  const [usuari] = await db
    .insert(users)
    .values({
      email: "pau@exemple.cat",
      fullName: "Pau",
      passwordHash: await hashPassword("provaprovaprova"),
      isAdmin: false,
      isActive: true,
    })
    .returning();
  await db
    .insert(userLedgerPermissions)
    .values({ userId: usuari?.id ?? 0, ledgerId, role: "admin" });

  const [connexio] = await db
    .insert(bankConnections)
    .values({
      name: "Prova",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();

  const [compte] = await db
    .insert(accounts)
    .values({
      connectionId: connexio?.id ?? 0,
      ledgerId,
      ebAccountUid: "uid-proves",
      name: "Compte",
      product: "",
      iban: "ES0000000000000000000000",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  accountId = compte?.id ?? 0;
});

describe("crear categories", () => {
  test("una subcategoria hereta el tipus del pare", async () => {
    const pare = await categoriaPerSlug("ingressos-del-treball");
    const filla = await creaCategoria(ledgerId, {
      name: "Bonus",
      // A posta el contrari del pare: s'ha d'ignorar.
      kind: "expense",
      parentId: pare.id,
      color: "#94a3b8",
      icon: "",
      isSubscription: false,
    });

    expect(filla.kind).toBe("income");
    expect(filla.slug).toBe("ingressos-del-treball-bonus");
    expect(filla.isSystem).toBe(false);
  });

  test("no s'admet un tercer nivell", async () => {
    const filla = await categoriaPerSlug("ingressos-del-treball-bonus");
    await expect(
      creaCategoria(ledgerId, {
        name: "Massa endins",
        kind: "income",
        parentId: filla.id,
        color: "#94a3b8",
        icon: "",
        isSubscription: false,
      }),
    ).rejects.toThrow(AppError);
  });

  test("dos noms iguals donen pendents diferents", async () => {
    const pare = await categoriaPerSlug("rendes");
    const a = await creaCategoria(ledgerId, {
      name: "Extra",
      kind: "income",
      parentId: pare.id,
      color: "#94a3b8",
      icon: "",
      isSubscription: false,
    });
    const b = await creaCategoria(ledgerId, {
      name: "Extra",
      kind: "income",
      parentId: pare.id,
      color: "#94a3b8",
      icon: "",
      isSubscription: false,
    });

    expect(a.slug).toBe("rendes-extra");
    expect(b.slug).toBe("rendes-extra-2");
  });

  test("no es pot penjar d'un pare d'un altre espai", async () => {
    const forana = await categoriaPerSlug("habitatge", altreLedgerId);
    await expect(
      creaCategoria(ledgerId, {
        name: "Intrusa",
        kind: "expense",
        parentId: forana.id,
        color: "#94a3b8",
        icon: "",
        isSubscription: false,
      }),
    ).rejects.toThrow();
  });
});

describe("esborrar categories", () => {
  test("una de buida se'n va sense mes", async () => {
    const c = await creaCategoria(ledgerId, {
      name: "Efimera",
      kind: "expense",
      parentId: null,
      color: "#94a3b8",
      icon: "",
      isSubscription: false,
    });
    await esborraCategoria(c.id, ledgerId, null);
    await expect(categoriaDeLespai(c.id, ledgerId)).rejects.toThrow();
  });

  test("les del sistema protegides no es poden esborrar", async () => {
    const c = await categoriaPerSlug(SLUG_UNCATEGORIZED);
    await expect(esborraCategoria(c.id, ledgerId, null)).rejects.toThrow(AppError);
    expect(await categoriaDeLespai(c.id, ledgerId)).toBeDefined();
  });

  test("una amb subcategories demana que primer les moguis", async () => {
    const pare = await categoriaPerSlug("habitatge");
    await expect(esborraCategoria(pare.id, ledgerId, null)).rejects.toThrow(AppError);
  });

  test("una amb moviments i sense desti es un 409", async () => {
    const c = await categoriaPerSlug("restauracio-restaurants");
    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "prova-409",
      source: "manual",
      bookingDate: "2026-01-15",
      amount: "-12.50",
      currency: "EUR",
      status: "booked",
      description: "Sopar",
      normalizedDescription: "SOPAR",
      counterparty: "Bar",
      bankTransactionCode: "",
      categoryId: c.id,
      categorySource: "user",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    await expect(esborraCategoria(c.id, ledgerId, null)).rejects.toThrow(ConflictError);
    // I sobretot: el moviment continua sent-hi.
    const queden = await db
      .select()
      .from(transactions)
      .where(eq(transactions.categoryId, c.id));
    expect(queden).toHaveLength(1);
  });

  test("amb desti, els moviments hi van i no se'n perd cap", async () => {
    const origen = await categoriaPerSlug("restauracio-restaurants");
    const desti = await categoriaPerSlug("restauracio-bars-i-cafeteries");

    // Una regla que assigna la categoria d'origen: la clau forana es CASCADE,
    // o sigui que si s'esborres primer la categoria, la regla desapareixeria.
    await db.insert(rules).values({
      name: "Regla de prova",
      ledgerId,
      priority: 100,
      isActive: true,
      conditions: [{ field: "description", operator: "contains", value: "SOPAR" }],
      setCategoryId: origen.id,
      setTags: [],
      source: "user",
      matchCount: 0,
    });

    await esborraCategoria(origen.id, ledgerId, desti.id);

    const moguts = await db
      .select()
      .from(transactions)
      .where(eq(transactions.categoryId, desti.id));
    expect(moguts).toHaveLength(1);

    const orfes = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ledgerId, ledgerId));
    expect(orfes.every((t) => t.categoryId !== null)).toBe(true);

    // La regla s'ha reassignat, no esborrat.
    const regles = await db.select().from(rules).where(eq(rules.ledgerId, ledgerId));
    expect(regles).toHaveLength(1);
    expect(regles[0]?.setCategoryId).toBe(desti.id);
  });

  test("no es pot reassignar a una categoria d'un altre espai", async () => {
    const c = await creaCategoria(ledgerId, {
      name: "Amb moviment",
      kind: "expense",
      parentId: null,
      color: "#94a3b8",
      icon: "",
      isSubscription: false,
    });
    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "prova-forana",
      source: "manual",
      bookingDate: "2026-01-16",
      amount: "-3.00",
      currency: "EUR",
      status: "booked",
      description: "Cafe",
      normalizedDescription: "CAFE",
      counterparty: "",
      bankTransactionCode: "",
      categoryId: c.id,
      categorySource: "user",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    const forana = await categoriaPerSlug("habitatge", altreLedgerId);
    await expect(esborraCategoria(c.id, ledgerId, forana.id)).rejects.toThrow();

    // Ni s'ha esborrat ni s'ha mogut res.
    expect(await categoriaDeLespai(c.id, ledgerId)).toBeDefined();
  });
});

describe("les opcions del selector", () => {
  test("van en grups de dos nivells", async () => {
    const grups = await opcionsCategories(ledgerId);
    expect(grups.length).toBeGreaterThan(0);
    for (const grup of grups) {
      expect(grup.opcions.length).toBeGreaterThan(0);
    }
  });

  test("es poden excloure categories", async () => {
    const c = await categoriaPerSlug("habitatge");
    const grups = await opcionsCategories(ledgerId, [c.id]);
    const ids = grups.flatMap((g) => g.opcions.map((o) => o.valor));
    expect(ids).not.toContain(c.id);
  });

  test("nomes hi surten les d'aquest espai", async () => {
    const grups = await opcionsCategories(ledgerId);
    const ids = grups.flatMap((g) => g.opcions.map((o) => o.valor));
    const foranes = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.ledgerId, altreLedgerId));
    for (const forana of foranes) {
      expect(ids).not.toContain(forana.id);
    }
  });
});
