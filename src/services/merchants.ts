/**
 * Memoria de comerços.
 *
 * Dins d'un espai, un comerç es classifica **una sola vegada**. Entre espais
 * no es comparteix res: el mateix Mercadona es un comerç diferent a Personal i
 * a Calella, perque cadascun te els seus usuaris i el seu pla de categories, i
 * perque el nom d'un comerç sovint es el nom d'una persona.
 *
 * Traduccio de `backend/app/services/merchants.py` i de la part de
 * `classification.remember_merchant_choice`.
 */

import { and, asc, count, desc, eq, ilike, isNull, ne, or, type SQL } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { categories, merchants, transactions, type Merchant } from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";

/** Filtres de la llista de comerços. */
export interface FiltresComercos {
  cerca: string;
  nomesSenseClassificar: boolean;
  nomesSenseConfirmar: boolean;
  limit: number;
  offset: number;
}

export interface ComercVista {
  id: number;
  normalizedName: string;
  displayName: string;
  defaultCategoryId: number | null;
  /** El nom de la categoria, per no fer una consulta per fila. */
  categoryName: string | null;
  isConfirmed: boolean;
  transactionCount: number;
  lastSeenAt: string | null;
}

export interface PaginaComercos {
  items: ComercVista[];
  total: number;
  limit: number;
  offset: number;
}

function condicions(ledgerId: number, filtres: FiltresComercos): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(merchants.ledgerId, ledgerId)];

  const cerca = filtres.cerca.trim();
  if (cerca) {
    const patro = `%${cerca}%`;
    parts.push(or(ilike(merchants.normalizedName, patro), ilike(merchants.displayName, patro)));
  }
  if (filtres.nomesSenseClassificar) parts.push(isNull(merchants.defaultCategoryId));
  if (filtres.nomesSenseConfirmar) parts.push(eq(merchants.isConfirmed, false));

  return and(...parts);
}

/**
 * Els comerços de l'espai, els que mes surten primer.
 *
 * Es demanen columnes explicites i s'hi ajunta el nom de la categoria: aixi la
 * plantilla no ha de fer cap consulta ni rep mai la fila sencera.
 */
export async function llistaComercos(
  ledgerId: number,
  filtres: FiltresComercos,
): Promise<PaginaComercos> {
  const on = condicions(ledgerId, filtres);

  const [total] = await db.select({ n: count() }).from(merchants).where(on);

  const files = await db
    .select({
      id: merchants.id,
      normalizedName: merchants.normalizedName,
      displayName: merchants.displayName,
      defaultCategoryId: merchants.defaultCategoryId,
      categoryName: categories.name,
      isConfirmed: merchants.isConfirmed,
      transactionCount: merchants.transactionCount,
      lastSeenAt: merchants.lastSeenAt,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
    .where(on)
    .orderBy(desc(merchants.transactionCount), asc(merchants.normalizedName))
    .limit(filtres.limit)
    .offset(filtres.offset);

  return {
    items: files,
    total: total?.n ?? 0,
    limit: filtres.limit,
    offset: filtres.offset,
  };
}

/** Un comerç d'aquest espai, o 404. */
export async function comercDeLespai(id: number, ledgerId: number): Promise<Merchant> {
  const [comerc] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, id), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!comerc) throw new NotFoundError("Aquest comerç no existeix");
  return comerc;
}

/** Torna la vista d'un comerç, per redibuixar-ne la fila. */
export async function vistaComerc(id: number, ledgerId: number): Promise<ComercVista> {
  const [fila] = await db
    .select({
      id: merchants.id,
      normalizedName: merchants.normalizedName,
      displayName: merchants.displayName,
      defaultCategoryId: merchants.defaultCategoryId,
      categoryName: categories.name,
      isConfirmed: merchants.isConfirmed,
      transactionCount: merchants.transactionCount,
      lastSeenAt: merchants.lastSeenAt,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
    .where(and(eq(merchants.id, id), eq(merchants.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquest comerç no existeix");
  return fila;
}

/**
 * Desa la decisio d'una persona sobre un comerç i la propaga dins del seu espai.
 *
 * Els moviments que ja tenen categoria posada **per una persona**
 * (`category_source = 'user'`) no es toquen mai: aquella decisio mana per
 * sobre de tot. Retorna quants moviments s'han canviat.
 *
 * Les dues escriptures van juntes. Si nomes passes la primera, el comerç diu
 * «confirmat, categoria X» i els seus moviments continuen amb la d'abans; i
 * aixo no s'adoba sol, perque `classificaPendents` nomes recull els moviments
 * sense categoria o marcats per revisar, i aquests no en son cap dels dos.
 *
 * `connexio.transaction()` val tant per a la piscina com per a una transaccio
 * que ja estigui oberta: dins d'una altra, Postgres hi posa un punt de
 * seguretat i prou.
 */
export async function recordaEleccioComerc(
  comerc: Merchant,
  categoryId: number | null,
  aplicaAlsExistents = true,
  connexio: Transactor = db,
): Promise<number> {
  return connexio.transaction(async (tx) => {
    await tx
      .update(merchants)
      .set({
        defaultCategoryId: categoryId,
        categorySource: "user",
        isConfirmed: true,
      })
      .where(eq(merchants.id, comerc.id));

    if (!aplicaAlsExistents) return 0;

    const canviats = await tx
      .update(transactions)
      .set({
        categoryId,
        categorySource: "merchant",
        categoryConfidence: 1,
        needsReview: false,
      })
      .where(
        and(
          eq(transactions.merchantId, comerc.id),
          // La decisio d'una persona no la sobreescriu res.
          ne(transactions.categorySource, "user"),
        ),
      )
      .returning({ id: transactions.id });

    return canviats.length;
  });
}

/** Canvia el nom que es veu d'un comerç. */
export async function reanomenaComerc(
  id: number,
  ledgerId: number,
  displayName: string,
): Promise<void> {
  await comercDeLespai(id, ledgerId);
  await db
    .update(merchants)
    .set({ displayName: displayName.slice(0, 200) })
    .where(eq(merchants.id, id));
}

/**
 * Assigna la categoria per defecte d'un comerç.
 *
 * La categoria ha de ser d'aquest espai: si no, s'hi podrien enganxar
 * moviments a la comptabilitat d'un altre.
 */
export async function assignaCategoria(
  id: number,
  ledgerId: number,
  categoryId: number | null,
  aplicaAlsExistents = true,
): Promise<number> {
  const comerc = await comercDeLespai(id, ledgerId);

  if (categoryId !== null) {
    const [categoria] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)))
      .limit(1);
    if (!categoria) throw new AppError("La categoria no es d'aquest espai", 422);
  }

  return recordaEleccioComerc(comerc, categoryId, aplicaAlsExistents);
}

/**
 * El comerç d'aquest espai amb aquest nom normalitzat, creant-lo si cal.
 *
 * La fa servir la sincronitzacio, un cop per moviment nou.
 */
export async function obteOCreaComerc(
  ledgerId: number,
  normalizedName: string,
  display = "",
  seenOn: string | null = null,
  connexio: Transactor = db,
): Promise<Merchant | null> {
  const nom = (normalizedName || "").trim();
  if (!nom) return null;

  const [existent] = await connexio
    .select()
    .from(merchants)
    .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.normalizedName, nom)))
    .limit(1);

  let comerc = existent;
  if (!comerc) {
    const [creat] = await connexio
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: nom.slice(0, 200),
        displayName: (display || nom).slice(0, 200),
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();
    comerc = creat;
  }
  if (!comerc) return null;

  const vistUltim =
    seenOn !== null && (comerc.lastSeenAt === null || seenOn > comerc.lastSeenAt)
      ? seenOn
      : comerc.lastSeenAt;

  const [actualitzat] = await connexio
    .update(merchants)
    .set({ transactionCount: comerc.transactionCount + 1, lastSeenAt: vistUltim })
    .where(eq(merchants.id, comerc.id))
    .returning();

  return actualitzat ?? comerc;
}
