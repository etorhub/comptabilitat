/**
 * Categories: arbre, estadistiques i esborrat amb reassignacio.
 *
 * Traduccio de `backend/app/api/routes/categories.py`, amb la logica treta de
 * la ruta i posada aqui.
 */

import { and, count, eq, isNotNull,  sum } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  llmSuggestions,
  merchants,
  recurringSeries,
  rules,
  transactions,
  type Category,
  type CategoryKind,
} from "../db/schema/index.ts";
import { AppError, ConflictError, NotFoundError } from "../lib/http.ts";
import { money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { PROTECTED_SLUGS, slugify } from "./slugs.ts";

/** Una categoria amb el que se n'ensenya a la pantalla. */
export interface CategoriaVista {
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
  isSubscription: boolean;
  transactionCount: number;
  totalAmount: MoneyString;
  /** Es una de les que no es poden esborrar mai. */
  isProtected: boolean;
}

export interface NodeCategoria extends CategoriaVista {
  filles: CategoriaVista[];
}

/** Les categories de l'espai, en l'ordre en que s'han de mostrar. */
export async function llistaCategories(ledgerId: number): Promise<Category[]> {
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
async function estadistiques(ledgerId: number): Promise<Map<number, [number, MoneyString]>> {
  const files = await db
    .select({
      categoryId: transactions.categoryId,
      n: count(transactions.id),
      total: sum(transactions.amount),
    })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), isNotNull(transactions.categoryId)))
    .groupBy(transactions.categoryId);

  const propies = new Map<number, [number, MoneyString]>();
  for (const fila of files) {
    if (fila.categoryId === null) continue;
    propies.set(fila.categoryId, [fila.n, fila.total ?? "0.00"]);
  }
  return propies;
}

function acumula(
  totes: Category[],
  propies: Map<number, [number, MoneyString]>,
): Map<number, [number, MoneyString]> {
  const acumulades = new Map<number, [number, MoneyString]>();
  for (const categoria of totes) {
    acumulades.set(categoria.id, propies.get(categoria.id) ?? [0, "0.00"]);
  }
  for (const categoria of totes) {
    if (categoria.parentId === null) continue;
    const pare = acumulades.get(categoria.parentId);
    const filla = acumulades.get(categoria.id);
    if (!pare || !filla) continue;
    acumulades.set(categoria.parentId, [
      pare[0] + filla[0],
      toMoneyString(money(pare[1]).plus(money(filla[1]))),
    ]);
  }
  return acumulades;
}

/** L'arbre sencer, agrupat per tipus, amb estadistiques si es demanen. */
export async function arbreCategories(
  ledgerId: number,
  ambEstadistiques = true,
): Promise<Record<CategoryKind, NodeCategoria[]>> {
  const totes = await llistaCategories(ledgerId);
  const stats = ambEstadistiques
    ? acumula(totes, await estadistiques(ledgerId))
    : new Map<number, [number, MoneyString]>();

  const perId = new Map(totes.map((c) => [c.id, c]));
  const vista = (c: Category): CategoriaVista => {
    const [n, total] = stats.get(c.id) ?? [0, "0.00"];
    const pare = c.parentId === null ? undefined : perId.get(c.parentId);
    return {
      id: c.id,
      parentId: c.parentId,
      slug: c.slug,
      name: c.name,
      fullName: pare ? `${pare.name} › ${c.name}` : c.name,
      kind: c.kind,
      color: c.color,
      icon: c.icon,
      isSystem: c.isSystem,
      isSubscription: c.isSubscription,
      transactionCount: n,
      totalAmount: total,
      isProtected: PROTECTED_SLUGS.includes(c.slug),
    };
  };

  const arbre: Record<CategoryKind, NodeCategoria[]> = { expense: [], income: [], transfer: [] };
  for (const categoria of totes) {
    if (categoria.parentId !== null) continue;
    arbre[categoria.kind].push({
      ...vista(categoria),
      filles: totes.filter((c) => c.parentId === categoria.id).map(vista),
    });
  }
  return arbre;
}

/** Una categoria d'aquest espai, o 404. */
export async function categoriaDeLespai(id: number, ledgerId: number): Promise<Category> {
  const [categoria] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  if (!categoria) throw new NotFoundError("Aquesta categoria no existeix");
  return categoria;
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

export interface AltaCategoria {
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  color: string;
  icon: string;
  isSubscription: boolean;
}

export async function creaCategoria(ledgerId: number, dades: AltaCategoria): Promise<Category> {
  let pare: Category | null = null;
  if (dades.parentId !== null) {
    pare = await categoriaDeLespai(dades.parentId, ledgerId);
    // Nomes dos nivells: una categoria amb pare no en pot tenir de filles.
    if (pare.parentId !== null) {
      throw new AppError("Nomes s'admeten dos nivells de categories", 422);
    }
  }

  const base = pare ? `${pare.slug}-${slugify(dades.name)}` : slugify(dades.name);
  const slug = await pendentLliure(ledgerId, base);

  const [creada] = await db
    .insert(categories)
    .values({
      ledgerId,
      slug,
      name: dades.name,
      // Una subcategoria hereta sempre el tipus del pare.
      kind: pare ? pare.kind : dades.kind,
      parentId: pare?.id ?? null,
      color: dades.color,
      icon: dades.icon,
      isSystem: false,
      isSubscription: dades.isSubscription,
      position: 0,
    })
    .returning();

  if (!creada) throw new AppError("No s'ha pogut crear la categoria", 500);
  return creada;
}

export async function reanomenaCategoria(
  id: number,
  ledgerId: number,
  name: string,
): Promise<Category> {
  await categoriaDeLespai(id, ledgerId);
  const [actualitzada] = await db
    .update(categories)
    .set({ name })
    .where(eq(categories.id, id))
    .returning();
  if (!actualitzada) throw new NotFoundError("Aquesta categoria no existeix");
  return actualitzada;
}

export async function marcaSubscripcio(
  id: number,
  ledgerId: number,
  isSubscription: boolean,
): Promise<Category> {
  await categoriaDeLespai(id, ledgerId);
  const [actualitzada] = await db
    .update(categories)
    .set({ isSubscription })
    .where(eq(categories.id, id))
    .returning();
  if (!actualitzada) throw new NotFoundError("Aquesta categoria no existeix");
  return actualitzada;
}

/** Quants moviments hi ha en una categoria. */
export async function movimentsDe(categoryId: number): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(transactions)
    .where(eq(transactions.categoryId, categoryId));
  return fila?.n ?? 0;
}

async function tefilles(id: number, ledgerId: number): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.parentId, id)));
  return fila?.n ?? 0;
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
export async function esborraCategoria(
  id: number,
  ledgerId: number,
  reassignTo: number | null,
): Promise<void> {
  const categoria = await categoriaDeLespai(id, ledgerId);

  if (PROTECTED_SLUGS.includes(categoria.slug)) {
    throw new AppError("Aquesta categoria del sistema no es pot esborrar", 422);
  }

  if ((await tefilles(id, ledgerId)) > 0) {
    throw new AppError("Primer cal esborrar o moure les subcategories", 422);
  }

  const usats = await movimentsDe(id);
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
      await tx
        .update(recurringSeries)
        .set({ categoryId: reassignTo })
        .where(and(eq(recurringSeries.ledgerId, ledgerId), eq(recurringSeries.categoryId, id)));
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
export interface GrupCategories {
  etiqueta: string;
  opcions: { valor: number; text: string }[];
}

export async function opcionsCategories(
  ledgerId: number,
  excloure: readonly number[] = [],
): Promise<GrupCategories[]> {
  const totes = await llistaCategories(ledgerId);
  const fora = new Set(excloure);
  const grups: GrupCategories[] = [];

  for (const pare of totes) {
    if (pare.parentId !== null || fora.has(pare.id)) continue;
    const filles = totes.filter((c) => c.parentId === pare.id && !fora.has(c.id));
    const opcions = [
      // El pare tambe s'hi pot triar: hi ha moviments que no son de cap filla.
      { valor: pare.id, text: pare.name },
      ...filles.map((f) => ({ valor: f.id, text: `  ${f.name}` })),
    ];
    grups.push({ etiqueta: pare.name, opcions });
  }
  return grups;
}

/** Quantes categories hi ha a l'espai. Per saber si cal sembrar-hi el pla. */
export async function comptaCategories(ledgerId: number): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(categories)
    .where(eq(categories.ledgerId, ledgerId));
  return fila?.n ?? 0;
}

