/**
 * Categories: arbre, estadistiques i esborrat amb reassignacio.
 *
 * Traduccio de `backend/app/api/routes/categories.py`, amb la logica treta de
 * la ruta i posada aqui.
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

/** Una categoria amb el que se n'ensenya a la pantalla. */
export interface CategoryView {
  id: number;
  parentId: number | null;
  slug: string;
  name: string;
  /** «Pare › Filla», com el `full_name` del Python. */
  fullName: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  isSystem: boolean;
  transactionCount: number;
  totalAmount: MoneyString;
  /** Es una de les que no es poden esborrar mai. */
  isProtected: boolean;
}

export interface NodeCategory extends CategoryView {
  filles: CategoryView[];
}

/** Les categories de l'espai, en l'ordre en que s'han de mostrar. */
export async function listCategories(ledgerId: number): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(eq(categories.ledgerId, ledgerId))
    .orderBy(categories.kind, categories.position, categories.name);
}

/**
 * Nombre de moviments i suma per categoria, amb les filles **acumulades al
 * pare**, com feia `_rollup_stats`.
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

/** L'arbre sencer, agrupat per tipus, amb estadistiques si es demanen. */
export async function categoryTree(
  ledgerId: number,
  ambEstadistiques = true,
): Promise<Record<CategoryKind, NodeCategory[]>> {
  const all = await listCategories(ledgerId);
  const stats = ambEstadistiques
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

/** Una categoria d'aquest espai, o 404. */
export async function categoryInWorkspace(id: number, ledgerId: number): Promise<Category> {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  if (!category) throw new NotFoundError("Aquesta categoria no existeix");
  return category;
}

/** Un pendent unic dins de l'espai, afegint-hi `-2`, `-3`... si cal. */
async function pendentLliure(ledgerId: number, base: string): Promise<string> {
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
    // Nomes dos nivells: una categoria amb pare no en pot tenir de filles.
    if (parent.parentId !== null) {
      throw new AppError("Nomes s'admeten dos nivells de categories", 422);
    }
  }

  const base = parent ? `${parent.slug}-${slugify(data.name)}` : slugify(data.name);
  const slug = await pendentLliure(ledgerId, base);

  const [creada] = await db
    .insert(categories)
    .values({
      ledgerId,
      slug,
      name: data.name,
      // Una subcategoria hereta sempre el tipus del pare.
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

/** Quants moviments hi ha en una categoria. */
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
 * Esborra una categoria.
 *
 * Si te moviments i no es diu on han d'anar, es un **409**: la interficie el
 * fa servir per demanar a qui sigui que triï una categoria de desti.
 *
 * Compte amb l'ordre: cal reassignar-ho tot **abans** d'esborrar, perque la
 * clau forana de `rules.set_category_id` es CASCADE i esborrar primer se
 * n'enduria les regles que hi apuntaven.
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

  const usats = await transactionsOf(id);
  if (usats > 0 && reassignTo === null) {
    throw new ConflictError(
      `Hi ha ${usats} ${usats === 1 ? "moviment" : "moviments"} en aquesta categoria`,
      "Tria a quina categoria han d'anar a parar.",
    );
  }

  await db.transaction(async (tx) => {
    if (reassignTo !== null) {
      if (reassignTo === id) {
        throw new AppError("No es pot reassignar a la mateixa categoria", 422);
      }
      // Que sigui d'aquest espai: si no, es podrien moure moviments a un altre.
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
      // Les series recurrents d'aquesta categoria s'esborren en cascada
      // (`fk_recurring_series_category_id_categories`). Si la de desti te
      // el mateix patro, `detectaRecurrents` les torna a proposar.
      await tx
        .update(llmSuggestions)
        .set({ suggestedCategoryId: reassignTo })
        .where(eq(llmSuggestions.suggestedCategoryId, id));
    }

    await tx.delete(categories).where(eq(categories.id, id));
  });
}

/**
 * Les categories com a opcions per a un `<select>` amb `<optgroup>`.
 *
 * Aixo es el que substitueix el `SelectorCategoria` de 372 linies: dos nivells
 * son exactament el que un `<optgroup>` sap fer.
 */
export interface CategoryGroup {
  tag: string;
  options: { valor: number; text: string }[];
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
      // El pare tambe s'hi pot triar: hi ha moviments que no son de cap filla.
      { valor: parent.id, text: parent.name },
      ...filles.map((f) => ({ valor: f.id, text: `  ${f.name}` })),
    ];
    groups.push({ tag: parent.name, options });
  }
  return groups;
}

/** Quantes categories hi ha a l'espai. Per saber si cal sembrar-hi el pla. */
export async function countCategories(ledgerId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(categories)
    .where(eq(categories.ledgerId, ledgerId));
  return row?.n ?? 0;
}
