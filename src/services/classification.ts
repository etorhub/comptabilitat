/**
 * Assignacio de categoria als moviments d'un espai.
 *
 * L'ordre de resolucio es sempre el mateix, del mes barat i explicit al mes
 * car:
 *
 *   1. **la decisio d'una persona, que no es toca mai**;
 *   2. les regles de l'espai, per prioritat;
 *   3. la memoria de comerços de l'espai;
 *   4. el model local, que nomes mira els comerços que no han encaixat enlloc.
 *
 * Tot passa dins d'un sol espai: res del que es decideix aqui afecta els
 * altres. Traduccio de `backend/app/services/classification.py`.
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import {
  categories,
  merchants,
  rules,
  transactions,
  type CategorySource,
  type Rule,
} from "../db/schema/index.ts";
import { primeraQueEncaixa, reglesActives, type MovimentAvaluable } from "./rules.ts";
import { SLUG_INTERNAL_TRANSFER, SLUG_UNCATEGORIZED } from "./slugs.ts";

export interface EstadistiquesClassificacio {
  perRegla: number;
  perComerc: number;
  pendents: number;
}

export function resumEstadistiques(s: EstadistiquesClassificacio): string {
  return `${s.perRegla} per regla, ${s.perComerc} per comerç, ${s.pendents} pendents de revisar`;
}

/** El moviment tal com el necessita la classificacio. */
interface MovimentClassificable extends MovimentAvaluable {
  id: number;
  merchantId: number | null;
  categorySource: CategorySource;
  tags: string[];
}

/**
 * Classifica un moviment. **No toca mai el que ha decidit una persona.**
 *
 * Retorna d'on ha sortit la categoria. Escriu directament a la base de dades,
 * de manera que es pot cridar dins d'una transaccio.
 */
export async function classificaMoviment(
  moviment: MovimentClassificable,
  regles: Rule[],
  connexio: Transactor = db,
): Promise<CategorySource> {
  if (moviment.categorySource === "user") return "user";

  // Un compte encara sense espai assignat no te ni regles ni categories.
  if (moviment.ledgerId === null) return "none";

  const regla = primeraQueEncaixa(regles, moviment);
  if (regla !== null) {
    const etiquetes =
      regla.setTags.length > 0
        ? [...new Set([...(moviment.tags ?? []), ...regla.setTags])].toSorted()
        : moviment.tags;

    await connexio
      .update(transactions)
      .set({
        ...(regla.setCategoryId !== null ? { categoryId: regla.setCategoryId } : {}),
        ...(regla.setMerchantId !== null ? { merchantId: regla.setMerchantId } : {}),
        tags: etiquetes,
        categorySource: "rule",
        categoryConfidence: 1,
        needsReview: false,
        appliedRuleId: regla.id,
      })
      .where(eq(transactions.id, moviment.id));

    await connexio
      .update(rules)
      .set({ matchCount: regla.matchCount + 1 })
      .where(eq(rules.id, regla.id));
    // El comptador de la regla que tenim a la ma tambe puja, perque la
    // mateixa llista de regles es fa servir per a tots els moviments del lot.
    regla.matchCount += 1;

    return "rule";
  }

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
  description: transactions.description,
  normalizedDescription: transactions.normalizedDescription,
  counterparty: transactions.counterparty,
  amount: transactions.amount,
  bankTransactionCode: transactions.bankTransactionCode,
  accountId: transactions.accountId,
  merchantId: transactions.merchantId,
  categorySource: transactions.categorySource,
  tags: transactions.tags,
} as const;

/**
 * Classifica els moviments d'un espai que encara no tenen categoria.
 *
 * Nomes mira els que venen de `none` o de `merchant`: els que ha posat una
 * regla ja estan resolts, i els que ha posat una persona no es toquen.
 */
export async function classificaPendents(
  ledgerId: number,
  limit?: number,
): Promise<EstadistiquesClassificacio> {
  const estadistiques: EstadistiquesClassificacio = {
    perRegla: 0,
    perComerc: 0,
    pendents: 0,
  };

  const regles = await reglesActives(ledgerId);

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
    const origen = await classificaMoviment(moviment, regles);
    if (origen === "rule") estadistiques.perRegla += 1;
    else if (origen === "merchant") estadistiques.perComerc += 1;
    else estadistiques.pendents += 1;
  }

  return estadistiques;
}

/**
 * Crea una regla apresa a partir d'una correccio d'una persona.
 *
 * Es idempotent: si ja hi ha una regla apresa igual, la retorna en lloc de
 * fer-ne una altra.
 */
export async function construeixReglaApresa(
  moviment: { ledgerId: number | null; normalizedDescription: string; counterparty: string },
  categoryId: number | null,
  createdById: number | null = null,
): Promise<Rule | null> {
  const patro = moviment.normalizedDescription || moviment.counterparty;
  if (!patro || categoryId === null || moviment.ledgerId === null) return null;

  const nom = patro.slice(0, 160);

  const [existent] = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.source, "learned"),
        eq(rules.ledgerId, moviment.ledgerId),
        eq(rules.setCategoryId, categoryId),
        eq(rules.name, nom),
      ),
    )
    .limit(1);
  if (existent) return existent;

  const [creada] = await db
    .insert(rules)
    .values({
      name: nom,
      ledgerId: moviment.ledgerId,
      priority: 50,
      isActive: true,
      conditions: [{ field: "normalized_description", operator: "equals", value: patro }],
      setCategoryId: categoryId,
      setMerchantId: null,
      setTags: [],
      source: "learned",
      createdById,
      matchCount: 0,
    })
    .returning();

  return creada ?? null;
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
