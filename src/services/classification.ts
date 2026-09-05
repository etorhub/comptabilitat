/**
 * Assignacio de categoria als moviments d'un espai.
 *
 * L'ordre de resolucio es sempre el mateix, del mes barat i explicit al mes
 * car:
 *
 *   1. **la decisio d'una persona, que no es toca mai**;
 *   2. la memoria de comerços de l'espai;
 *   3. el que queda, pendent de revisar.
 *
 * Tot passa dins d'un sol espai: res del que es decideix aqui afecta els
 * altres. Traduccio de `backend/app/services/classification.py` (sense el
 * pas de regles, que s'ha tret del producte).
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import {
  categories,
  merchants,
  transactions,
  type CategorySource,
} from "../db/schema/index.ts";
import { SLUG_INTERNAL_TRANSFER, SLUG_UNCATEGORIZED } from "./slugs.ts";

export interface EstadistiquesClassificacio {
  perComerc: number;
  pendents: number;
}

export function resumEstadistiques(s: EstadistiquesClassificacio): string {
  return `${s.perComerc} per comerç, ${s.pendents} pendents de revisar`;
}

/** El moviment tal com el necessita la classificacio. */
interface MovimentClassificable {
  id: number;
  ledgerId: number | null;
  merchantId: number | null;
  categorySource: CategorySource;
}

/**
 * Classifica un moviment. **No toca mai el que ha decidit una persona.**
 *
 * Retorna d'on ha sortit la categoria. Escriu directament a la base de dades,
 * de manera que es pot cridar dins d'una transaccio.
 */
export async function classificaMoviment(
  moviment: MovimentClassificable,
  connexio: Transactor = db,
): Promise<CategorySource> {
  if (moviment.categorySource === "user") return "user";

  // Un compte encara sense espai assignat no te categories.
  if (moviment.ledgerId === null) return "none";

  if (moviment.merchantId !== null) {
    const [comerc] = await connexio
      .select()
      .from(merchants)
      .where(eq(merchants.id, moviment.merchantId))
      .limit(1);

    if (comerc && comerc.defaultCategoryId !== null) {
      await connexio
        .update(transactions)
        .set({
          categoryId: comerc.defaultCategoryId,
          categorySource: "merchant",
          // Si el comerç l'ha confirmat una persona, ens en refiem del tot;
          // si no, es una suposicio i algu l'ha de mirar.
          categoryConfidence: comerc.isConfirmed ? 1 : 0.8,
          needsReview: !comerc.isConfirmed,
        })
        .where(eq(transactions.id, moviment.id));
      return "merchant";
    }
  }

  await connexio
    .update(transactions)
    .set({ categorySource: "none", needsReview: true })
    .where(eq(transactions.id, moviment.id));
  return "none";
}

/** Els camps que la classificacio necessita d'un moviment. */
const CAMPS_CLASSIFICACIO = {
  id: transactions.id,
  ledgerId: transactions.ledgerId,
  merchantId: transactions.merchantId,
  categorySource: transactions.categorySource,
} as const;

/**
 * Classifica els moviments d'un espai que encara no tenen categoria.
 *
 * Nomes mira els que venen de `none` o de `merchant`: els que ha posat una
 * persona no es toquen.
 */
export async function classificaPendents(
  ledgerId: number,
  limit?: number,
): Promise<EstadistiquesClassificacio> {
  const estadistiques: EstadistiquesClassificacio = {
    perComerc: 0,
    pendents: 0,
  };

  const consulta = db
    .select(CAMPS_CLASSIFICACIO)
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        inArray(transactions.categorySource, ["none", "merchant"]),
        or(isNull(transactions.categoryId), eq(transactions.needsReview, true)),
      ),
    )
    .orderBy(desc(transactions.bookingDate));

  const candidats = limit ? await consulta.limit(limit) : await consulta;

  for (const moviment of candidats) {
    const origen = await classificaMoviment(moviment);
    if (origen === "merchant") estadistiques.perComerc += 1;
    else estadistiques.pendents += 1;
  }

  return estadistiques;
}

/** Una categoria de l'espai pel seu pendent estable. */
export async function categoriaPerSlug(
  ledgerId: number,
  slug: string,
  connexio: Transactor = db,
) {
  const [categoria] = await connexio
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  return categoria ?? null;
}

export async function categoriaSenseClassificar(ledgerId: number, connexio: Transactor = db) {
  return categoriaPerSlug(ledgerId, SLUG_UNCATEGORIZED, connexio);
}

/**
 * La categoria dels traspassos interns. Si algu l'ha canviat de tipus, no
 * serveix: val mes no aparellar res que aparellar-ho malament.
 */
export async function categoriaTraspas(ledgerId: number, connexio: Transactor = db) {
  const categoria = await categoriaPerSlug(ledgerId, SLUG_INTERNAL_TRANSFER, connexio);
  if (categoria !== null && categoria.kind !== "transfer") return null;
  return categoria;
}
