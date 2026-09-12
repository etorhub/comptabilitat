/**
 * The category plan.
 *
 * What is checked here is that the slugs coming out of the plan are exactly
 * the ones the code looks up by name. If somebody renames a category of the
 * plan without thinking, the classification and the transfer pairing would
 * stop finding their category **in silence**.
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
  const [workspace] = await db
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
  ledgerId = workspace?.id ?? 0;
  await seedCategories(ledgerId);
});

describe("el pla de categories", () => {
  test("crea les 81 categories del pla", async () => {
    const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    expect(all).toHaveLength(81);
  });

  test("nomes te dos nivells", async () => {
    const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    const perId = new Map(all.map((c) => [c.id, c]));
    for (const category of all) {
      if (category.parentId === null) continue;
      expect(perId.get(category.parentId)?.parentId).toBeNull();
    }
  });

  test("conté els tres pendents dels quals depen el codi", async () => {
    const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    const slugs = new Set(all.map((c) => c.slug));

    expect(slugs).toContain(SLUG_UNCATEGORIZED);
    expect(slugs).toContain(SLUG_INTERNAL_TRANSFER);
    expect(slugs).toContain(SLUG_CASH_WITHDRAWAL);
  });

  test("les categories protegides existeixen i son del sistema", async () => {
    for (const slug of PROTECTED_SLUGS) {
      const [category] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1);
      expect(category).toBeDefined();
      expect(category?.isSystem).toBe(true);
    }
  });

  test("tornar-hi no duplica res", async () => {
    const creades = await seedCategories(ledgerId);
    expect(creades).toBe(0);
    const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
    expect(all).toHaveLength(81);
  });
});
