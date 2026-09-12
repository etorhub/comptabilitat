/**
 * Categories: tree, statistics and deletion with reassignment.
 *
 * A translation of `backend/app/api/routes/categories.py`, with the logic
 * taken out of the route and put here.
 */

import { and, count, eq, isNotNull, sum } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  llmSuggestions,
  merchants,
  rules,
  transactions,
  type Category,
  type CategoryKind,
} from "../db/schema/index.ts";
import { AppError, ConflictError, NotFoundError } from "../lib/http.ts";
import { money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { PROTECTED_SLUGS, slugify } from "./slugs.ts";

/** A category with what is shown of it on screen. */
export interface CategoryView {
  id: number;
  parentId: number | null;
  slug: string;
  name: string;
  /** «Parent › Child», like the Python's `full_name`. */
  fullName: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  isSystem: boolean;
  transactionCount: number;
  totalAmount: MoneyString;
  /** One of those that can never be deleted. */
  isProtected: boolean;
}

export interface NodeCategory extends CategoryView {
  filles: CategoryView[];
}

/** The workspace's categories, in the order they should be shown. */
export async function listCategories(ledgerId: number): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(eq(categories.ledgerId, ledgerId))
    .orderBy(categories.kind, categories.position, categories.name);
}

/**
 * Transaction count and sum per category, with the children **rolled up into
 * the parent**, as `_rollup_stats` did.
 */
async function rollupStats(ledgerId: number): Promise<Map<number, [number, MoneyString]>> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      n: count(transactions.id),
      total: sum(transactions.amount),
    })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), isNotNull(transactions.categoryId)))
    .groupBy(transactions.categoryId);

  const propies = new Map<number, [number, MoneyString]>();
  for (const row of rows) {
    if (row.categoryId === null) continue;
    propies.set(row.categoryId, [row.n, row.total ?? "0.00"]);
  }
  return propies;
}

function acumula(
  all: Category[],
  propies: Map<number, [number, MoneyString]>,
): Map<number, [number, MoneyString]> {
  const acumulades = new Map<number, [number, MoneyString]>();
  for (const category of all) {
    acumulades.set(category.id, propies.get(category.id) ?? [0, "0.00"]);
  }
  for (const category of all) {
    if (category.parentId === null) continue;
    const parent = acumulades.get(category.parentId);
    const filla = acumulades.get(category.id);
    if (!parent || !filla) continue;
    acumulades.set(category.parentId, [
      parent[0] + filla[0],
      toMoneyString(money(parent[1]).plus(money(filla[1]))),
    ]);
  }
  return acumulades;
}

/** The whole tree, grouped by type, with statistics if they are asked for. */
export async function categoryTree(
  ledgerId: number,
  withStats = true,
): Promise<Record<CategoryKind, NodeCategory[]>> {
  const all = await listCategories(ledgerId);
  const stats = withStats
    ? acumula(all, await rollupStats(ledgerId))
    : new Map<number, [number, MoneyString]>();

  const perId = new Map(all.map((c) => [c.id, c]));
  const view = (c: Category): CategoryView => {
    const [n, total] = stats.get(c.id) ?? [0, "0.00"];
    const parent = c.parentId === null ? undefined : perId.get(c.parentId);
    return {
      id: c.id,
      parentId: c.parentId,
      slug: c.slug,
      name: c.name,
      fullName: parent ? `${parent.name} › ${c.name}` : c.name,
      kind: c.kind,
      color: c.color,
      icon: c.icon,
      isSystem: c.isSystem,
      transactionCount: n,
      totalAmount: total,
      isProtected: PROTECTED_SLUGS.includes(c.slug),
    };
  };

  const tree: Record<CategoryKind, NodeCategory[]> = {
    expense: [],
    income: [],
    transfer: [],
  };
  for (const category of all) {
    if (category.parentId !== null) continue;
    tree[category.kind].push({
      ...view(category),
      filles: all.filter((c) => c.parentId === category.id).map(view),
    });
  }
  return tree;
}

/** A category of this workspace, or 404. */
export async function categoryInWorkspace(id: number, ledgerId: number): Promise<Category> {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  if (!category) throw new NotFoundError("Aquesta categoria no existeix");
  return category;
}

/** A slug unique within the workspace, adding `-2`, `-3`... if needed. */
async function freeSlug(ledgerId: number, base: string): Promise<string> {
  let candidat = base;
  let sufix = 2;
  for (;;) {
    const [xoc] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, candidat)))
      .limit(1);
    if (!xoc) return candidat;
    candidat = `${base}-${sufix}`;
    sufix += 1;
  }
}

export interface CreateCategory {
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  color: string;
  icon: string;
}

export async function createCategory(
  ledgerId: number,
  data: CreateCategory,
): Promise<Category> {
  let parent: Category | null = null;
  if (data.parentId !== null) {
    parent = await categoryInWorkspace(data.parentId, ledgerId);
    // Two levels only: a category with a parent cannot have children.
    if (parent.parentId !== null) {
      throw new AppError("Nomes s'admeten dos nivells de categories", 422);
    }
  }

  const base = parent ? `${parent.slug}-${slugify(data.name)}` : slugify(data.name);
  const slug = await freeSlug(ledgerId, base);

  const [creada] = await db
    .insert(categories)
    .values({
      ledgerId,
      slug,
      name: data.name,
      // A subcategory always inherits the parent's type.
      kind: parent ? parent.kind : data.kind,
      parentId: parent?.id ?? null,
      color: data.color,
      icon: data.icon,
      isSystem: false,
      position: 0,
    })
    .returning();

  if (!creada) throw new AppError("No s'ha pogut crear la categoria", 500);
  return creada;
}

export async function renameCategory(
  id: number,
  ledgerId: number,
  name: string,
): Promise<Category> {
  await categoryInWorkspace(id, ledgerId);
  const [actualitzada] = await db
    .update(categories)
    .set({ name })
    .where(eq(categories.id, id))
    .returning();
  if (!actualitzada) throw new NotFoundError("Aquesta categoria no existeix");
  return actualitzada;
}

/** How many transactions there are in a category. */
export async function transactionsOf(categoryId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(eq(transactions.categoryId, categoryId));
  return row?.n ?? 0;
}

async function tefilles(id: number, ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.parentId, id)));
  return row?.n ?? 0;
}

/**
 * Deletes a category.
 *
 * If it has transactions and no destination is given, it is a **409**: the
 * interface uses it to ask whoever it is to pick a destination category.
 *
 * Mind the order: everything has to be reassigned **before** deleting,
 * because the foreign key of `rules.set_category_id` is CASCADE and deleting
 * first would take away the rules that pointed at it.
 */
export async function deleteCategory(
  id: number,
  ledgerId: number,
  reassignTo: number | null,
): Promise<void> {
  const category = await categoryInWorkspace(id, ledgerId);

  if (PROTECTED_SLUGS.includes(category.slug)) {
    throw new AppError("Aquesta categoria del sistema no es pot esborrar", 422);
  }

  if ((await tefilles(id, ledgerId)) > 0) {
    throw new AppError("Primer cal esborrar o moure les subcategories", 422);
  }

  const used = await transactionsOf(id);
  if (used > 0 && reassignTo === null) {
    throw new ConflictError(
      `Hi ha ${used} ${used === 1 ? "moviment" : "moviments"} en aquesta categoria`,
      "Tria a quina categoria han d'anar a parar.",
    );
  }

  await db.transaction(async (tx) => {
    if (reassignTo !== null) {
      if (reassignTo === id) {
        throw new AppError("No es pot reassignar a la mateixa categoria", 422);
      }
      // It must belong to this workspace: otherwise transactions could be moved to another one.
      const [desti] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, reassignTo), eq(categories.ledgerId, ledgerId)))
        .limit(1);
      if (!desti) throw new NotFoundError("La categoria de desti no existeix");

      await tx
        .update(transactions)
        .set({ categoryId: reassignTo })
        .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.categoryId, id)));
      await tx
        .update(merchants)
        .set({ defaultCategoryId: reassignTo })
        .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.defaultCategoryId, id)));
      await tx
        .update(rules)
        .set({ setCategoryId: reassignTo })
        .where(and(eq(rules.ledgerId, ledgerId), eq(rules.setCategoryId, id)));
      // The recurring series of this category are deleted in cascade
      // (`fk_recurring_series_category_id_categories`). If the destination one
      // has the same pattern, `detectRecurring` proposes them again.
      await tx
        .update(llmSuggestions)
        .set({ suggestedCategoryId: reassignTo })
        .where(eq(llmSuggestions.suggestedCategoryId, id));
    }

    await tx.delete(categories).where(eq(categories.id, id));
  });
}

/**
 * The categories as options for a `<select>` with `<optgroup>`.
 *
 * This is what replaces the 372-line `SelectorCategoria`: two levels are
 * exactly what an `<optgroup>` knows how to do.
 */
export interface CategoryGroup {
  tag: string;
  options: { value: number; text: string }[];
}

export async function categoryOptions(
  ledgerId: number,
  excloure: readonly number[] = [],
): Promise<CategoryGroup[]> {
  const all = await listCategories(ledgerId);
  const fora = new Set(excloure);
  const groups: CategoryGroup[] = [];

  for (const parent of all) {
    if (parent.parentId !== null || fora.has(parent.id)) continue;
    const filles = all.filter((c) => c.parentId === parent.id && !fora.has(c.id));
    const options = [
      // The parent can be chosen too: some transactions belong to no child.
      { value: parent.id, text: parent.name },
      ...filles.map((f) => ({ value: f.id, text: `  ${f.name}` })),
    ];
    groups.push({ tag: parent.name, options });
  }
  return groups;
}

/** How many categories the workspace has. To know whether to seed the plan. */
export async function countCategories(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(categories)
    .where(eq(categories.ledgerId, ledgerId));
  return row?.n ?? 0;
}
