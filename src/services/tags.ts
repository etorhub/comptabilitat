/**
 * Etiquetes dels moviments.
 *
 * Son textos lliures a `transactions.tags` (varchar(40)[]): no hi ha taula
 * de catàleg. Les regles ja hi escriuen via `setTags`; aixo cobreix l'alta
 * manual, el llistat amb sumes i l'esborrat.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { transactions } from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";
import { money, toMoneyString, type MoneyString } from "../lib/money.ts";

const LONGITUD_MAX = 40;

/**
 * Neteja el text que ha escrit una persona.
 *
 * - espais exteriors fora, interiors col·lapsats;
 * - sense comes (el CSV uneix amb coma);
 * - 1–40 caracters.
 *
 * No canvia majuscules: l'ortografia canònica de l'espai la decideix
 * `ortografiaEspai()`.
 */
export function normalizeTag(bruta: string): string {
  const cleaned = bruta.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) {
    throw new AppError("Cal un nom d'etiqueta", 422);
  }
  if (cleaned.length > LONGITUD_MAX) {
    throw new AppError(`L'etiqueta pot tenir com a molt ${LONGITUD_MAX} caracters`, 422);
  }
  if (cleaned.includes(",")) {
    throw new AppError("L'etiqueta no pot dur comes", 422);
  }
  return cleaned;
}

/** Comparacio sense majuscules ni accents de longitud. */
export function sameTag(a: string, b: string): boolean {
  return a.toLocaleLowerCase("ca") === b.toLocaleLowerCase("ca");
}

/**
 * Si l'espai ja te una etiqueta amb el mateix nom (ignorant majuscules),
 * reutilitza aquella ortografia. Si no, torna el text normalitzat.
 */
export async function workspaceSpelling(ledgerId: number, name: string): Promise<string> {
  const cleaned = normalizeTag(name);
  const known = await workspaceTags(ledgerId);
  const existent = known.find((t) => sameTag(t, cleaned));
  return existent ?? cleaned;
}

/** Totes les etiquetes distintes de l'espai, ordenades. */
export async function workspaceTags(ledgerId: number): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`
    select distinct t.tag
    from transactions,
      lateral unnest(tags) as t(tag)
    where ledger_id = ${ledgerId}
      and cardinality(tags) > 0
    order by t.tag
  `);
  return [...rows].map((f) => f.tag);
}

export interface TagSummary {
  name: string;
  transactionCount: number;
  income: MoneyString;
  expenses: MoneyString;
  net: MoneyString;
}

/**
 * Llista d'etiquetes amb sumes.
 *
 * Mateix criteri que el llistat de moviments per defecte: sense traspassos
 * entre comptes propis. No filtra `is_excluded` ni `status` com els
 * informes: l'etiqueta es una etiqueta de gestio, no un tros d'informe.
 */
export async function listTags(ledgerId: number): Promise<TagSummary[]> {
  const rows = await db.execute<{
    name: string;
    transactionCount: number;
    income: string | null;
    expenses: string | null;
    net: string | null;
  }>(sql`
    select
      t.tag as name,
      count(*)::int as "transactionCount",
      coalesce(sum(case when amount > 0 then amount else 0 end), 0) as income,
      coalesce(sum(case when amount < 0 then abs(amount) else 0 end), 0) as expenses,
      coalesce(sum(amount), 0) as net
    from transactions,
      lateral unnest(tags) as t(tag)
    where ledger_id = ${ledgerId}
      and transfer_group_id is null
    group by t.tag
    order by t.tag
  `);

  return [...rows].map((f) => ({
    name: f.name,
    transactionCount: Number(f.transactionCount),
    income: toMoneyString(money(f.income)),
    expenses: toMoneyString(money(f.expenses)),
    net: toMoneyString(money(f.net)),
  }));
}

/** Resum d'una etiqueta (insensible a majuscules), o zeros si no n'hi ha. */
export async function summaryTag(ledgerId: number, name: string): Promise<TagSummary> {
  const cleaned = normalizeTag(name);
  const all = await listTags(ledgerId);
  const found = all.find((e) => sameTag(e.name, cleaned));
  if (found) return found;
  return {
    name: cleaned,
    transactionCount: 0,
    income: "0.00",
    expenses: "0.00",
    net: "0.00",
  };
}

/** Condicio SQL: el moviment duu aquesta etiqueta (ignorant majuscules). */
export function hasTag(name: string) {
  const cleaned = normalizeTag(name);
  return sql`exists (
    select 1 from unnest(${transactions.tags}) as e(t)
    where lower(e.t) = lower(${cleaned})
  )`;
}

/**
 * Afegeix una etiqueta a un moviment de l'espai.
 *
 * Retorna les etiquetes finals. Si ja la tenia (mateix nom sense majuscules),
 * no duplica.
 */
export async function addTag(
  movimentId: number,
  ledgerId: number,
  nomBrut: string,
): Promise<string[]> {
  const [row] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, movimentId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest moviment no existeix");

  const canònica = await workspaceSpelling(ledgerId, nomBrut);
  const actuals = row.tags ?? [];
  if (actuals.some((t) => sameTag(t, canònica))) {
    return actuals.toSorted();
  }

  const noves = [...actuals, canònica].toSorted();
  await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, movimentId));
  return noves;
}

/** Treu una etiqueta d'un moviment (insensible a majuscules). */
export async function removeTag(
  movimentId: number,
  ledgerId: number,
  nomBrut: string,
): Promise<string[]> {
  const cleaned = normalizeTag(nomBrut);
  const [row] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, movimentId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest moviment no existeix");

  const noves = (row.tags ?? []).filter((t) => !sameTag(t, cleaned)).toSorted();
  await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, movimentId));
  return noves;
}

/**
 * Afegeix la mateixa etiqueta a un lot de moviments de l'espai.
 *
 * **Tot o res:** si algun id no es de l'espai, no se'n toca cap.
 */
export async function addTagBulk(
  ids: number[],
  ledgerId: number,
  nomBrut: string,
): Promise<number> {
  const demanats = [...new Set(ids)];
  if (demanats.length === 0) throw new AppError("No hi ha cap moviment triat", 422);

  const meus = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, demanats)));

  if (meus.length !== demanats.length) {
    throw new NotFoundError("No s'ha trobat");
  }

  const canònica = await workspaceSpelling(ledgerId, nomBrut);
  let tocats = 0;
  for (const row of meus) {
    const actuals = row.tags ?? [];
    if (actuals.some((t) => sameTag(t, canònica))) continue;
    const noves = [...actuals, canònica].toSorted();
    await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, row.id));
    tocats += 1;
  }
  return tocats;
}

/**
 * Treu l'etiqueta de **tots** els moviments de l'espai.
 *
 * Retorna quants n'han quedat afectats.
 */
export async function deleteTagFromWorkspace(
  ledgerId: number,
  nomBrut: string,
): Promise<number> {
  const cleaned = normalizeTag(nomBrut);

  const afectats = await db.execute<{ id: number }>(sql`
    select id from transactions
    where ledger_id = ${ledgerId}
      and exists (
        select 1 from unnest(tags) as e(t)
        where lower(e.t) = lower(${cleaned})
      )
  `);

  const quants = [...afectats].length;
  if (quants === 0) return 0;

  await db.execute(sql`
    update transactions
    set tags = coalesce((
      select array_agg(e.t order by e.t)
      from unnest(tags) as e(t)
      where lower(e.t) <> lower(${cleaned})
    ), '{}'::varchar[])
    where ledger_id = ${ledgerId}
      and exists (
        select 1 from unnest(tags) as e(t)
        where lower(e.t) = lower(${cleaned})
      )
  `);

  return quants;
}

/** Parseja una llista separada per comes (formulari de regles). */
export function parseTagList(bruta: string): string[] {
  if (!bruta.trim()) return [];
  const views = new Set<string>();
  const result: string[] = [];
  for (const part of bruta.split(",")) {
    const cleaned = part.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    if (cleaned.length > LONGITUD_MAX) {
      throw new AppError(`Cada etiqueta pot tenir com a molt ${LONGITUD_MAX} caracters`, 422);
    }
    const key = cleaned.toLocaleLowerCase("ca");
    if (views.has(key)) continue;
    views.add(key);
    result.push(cleaned);
  }
  return result.toSorted();
}
