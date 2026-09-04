/**
 * El pla de categories.
 *
 * El que es comprova aqui es que els pendents que surten del pla siguin
 * exactament els que el codi busca pel nom. Si algu reanomena una categoria
 * del pla sense pensar-hi, la classificacio i l'aparellament de traspassos
 * deixarien de trobar la seva categoria **en silenci**.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import { categories, ledgers } from "../src/db/schema/index.ts";
import { seedCategories } from "../src/services/seed.ts";
import {
  PROTECTED_SLUGS,
  SLUG_CASH_WITHDRAWAL,
  SLUG_INTERNAL_TRANSFER,
  SLUG_UNCATEGORIZED,
} from "../src/services/slugs.ts";

let ledgerId = 0;

beforeAll(async () => {
  await db.delete(categories);
  await db.delete(ledgers);
  const [espai] = await db
    .insert(ledgers)
    .values({
      code: "prova",
      name: "Prova",
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
});

describe("el pla de categories", () => {
  test("crea les 81 categories del pla", async () => {
    const totes = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    expect(totes).toHaveLength(81);
  });

  test("nomes te dos nivells", async () => {
    const totes = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    const perId = new Map(totes.map((c) => [c.id, c]));
    for (const categoria of totes) {
      if (categoria.parentId === null) continue;
      expect(perId.get(categoria.parentId)?.parentId).toBeNull();
    }
  });

  test("conté els tres pendents dels quals depen el codi", async () => {
    const totes = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    const slugs = new Set(totes.map((c) => c.slug));

    expect(slugs).toContain(SLUG_UNCATEGORIZED);
    expect(slugs).toContain(SLUG_INTERNAL_TRANSFER);
    expect(slugs).toContain(SLUG_CASH_WITHDRAWAL);
  });

  test("les categories protegides existeixen i son del sistema", async () => {
    for (const slug of PROTECTED_SLUGS) {
      const [categoria] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1);
      expect(categoria).toBeDefined();
      expect(categoria?.isSystem).toBe(true);
    }
  });

  test("tornar-hi no duplica res", async () => {
    const creades = await seedCategories(ledgerId);
    expect(creades).toBe(0);
    const totes = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    expect(totes).toHaveLength(81);
  });
});
