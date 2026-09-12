/**
 * Transaction tags.
 *
 * They are free text in `transactions.tags` (varchar(40)[]): there is no
 * catalogue table. The rules already write there via `setTags`; this covers
 * the manual add, the listing with totals and the deletion.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { transactions } from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";
import { money, toMoneyString, type MoneyString } from "../lib/money.ts";

const MAX_LENGTH = 40;

/**
 * Cleans the text a person wrote.
 *
 * - outer spaces removed, inner ones collapsed;
 * - no commas (the CSV joins with a comma);
 * - 1–40 characters.
 *
 * It does not change case: the workspace's canonical spelling is decided by
 * `workspaceSpelling()`.
 */
export function normalizeTag(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) {
    throw new AppError("Cal un nom d'etiqueta", 422);
  }
  if (cleaned.length > MAX_LENGTH) {
    throw new AppError(`L'etiqueta pot tenir com a molt ${MAX_LENGTH} caracters`, 422);
  }
  if (cleaned.includes(",")) {
    throw new AppError("L'etiqueta no pot dur comes", 422);
  }
  return cleaned;
}

/** Case- and accent-insensitive comparison. */
export function sameTag(a: string, b: string): boolean {
  return a.toLocaleLowerCase("ca") === b.toLocaleLowerCase("ca");
}

/**
 * If the workspace already has a tag with the same name (ignoring case), that
 * spelling is reused. Otherwise the normalized text is returned.
 */
export async function workspaceSpelling(ledgerId: number, name: string): Promise<string> {
  const cleaned = normalizeTag(name);
  const known = await workspaceTags(ledgerId);
  const existing = known.find((t) => sameTag(t, cleaned));
  return existing ?? cleaned;
}

/** All the workspace's distinct tags, sorted. */
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
 * List of tags with totals.
 *
 * Same criterion as the default transaction listing: without transfers
 * between the owner's own accounts. It does not filter `is_excluded` or
 * `status` as the reports do: a tag is a management tag, not a piece of a report.
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

/** Summary of a tag (case-insensitive), or zeros if there is none. */
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

/** SQL condition: the transaction carries this tag (ignoring case). */
export function hasTag(name: string) {
  const cleaned = normalizeTag(name);
  return sql`exists (
    select 1 from unnest(${transactions.tags}) as e(t)
    where lower(e.t) = lower(${cleaned})
  )`;
}

/**
 * Adds a tag to a transaction of the workspace.
 *
 * Returns the final tags. If it already had it (same name ignoring case), it
 * does not duplicate.
 */
export async function addTag(
  transactionId: number,
  ledgerId: number,
  rawName: string,
): Promise<string[]> {
  const [row] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest moviment no existeix");

  const canonical = await workspaceSpelling(ledgerId, rawName);
  const current = row.tags ?? [];
  if (current.some((t) => sameTag(t, canonical))) {
    return current.toSorted();
  }

  const newOnes = [...current, canonical].toSorted();
  await db
    .update(transactions)
    .set({ tags: newOnes })
    .where(eq(transactions.id, transactionId));
  return newOnes;
}

/** Removes a tag from a transaction (case-insensitive). */
export async function removeTag(
  transactionId: number,
  ledgerId: number,
  rawName: string,
): Promise<string[]> {
  const cleaned = normalizeTag(rawName);
  const [row] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest moviment no existeix");

  const newOnes = (row.tags ?? []).filter((t) => !sameTag(t, cleaned)).toSorted();
  await db
    .update(transactions)
    .set({ tags: newOnes })
    .where(eq(transactions.id, transactionId));
  return newOnes;
}

/**
 * Adds the same tag to a batch of the workspace's transactions.
 *
 * **All or nothing:** if any id is not from the workspace, none is touched.
 */
export async function addTagBulk(
  ids: number[],
  ledgerId: number,
  rawName: string,
): Promise<number> {
  const requested = [...new Set(ids)];
  if (requested.length === 0) throw new AppError("No hi ha cap moviment triat", 422);

  const mine = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, requested)));

  if (mine.length !== requested.length) {
    throw new NotFoundError("No s'ha trobat");
  }

  const canonical = await workspaceSpelling(ledgerId, rawName);
  let touched = 0;
  for (const row of mine) {
    const current = row.tags ?? [];
    if (current.some((t) => sameTag(t, canonical))) continue;
    const newOnes = [...current, canonical].toSorted();
    await db.update(transactions).set({ tags: newOnes }).where(eq(transactions.id, row.id));
    touched += 1;
  }
  return touched;
}

/**
 * Removes the tag from **all** the workspace's transactions.
 *
 * Returns how many were affected.
 */
export async function deleteTagFromWorkspace(
  ledgerId: number,
  rawName: string,
): Promise<number> {
  const cleaned = normalizeTag(rawName);

  const affected = await db.execute<{ id: number }>(sql`
    select id from transactions
    where ledger_id = ${ledgerId}
      and exists (
        select 1 from unnest(tags) as e(t)
        where lower(e.t) = lower(${cleaned})
      )
  `);

  const howManyOf = [...affected].length;
  if (howManyOf === 0) return 0;

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

  return howManyOf;
}

/** Parses a comma-separated list (rules form). */
export function parseTagList(raw: string): string[] {
  if (!raw.trim()) return [];
  const views = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const cleaned = part.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    if (cleaned.length > MAX_LENGTH) {
      throw new AppError(`Cada etiqueta pot tenir com a molt ${MAX_LENGTH} caracters`, 422);
    }
    const key = cleaned.toLocaleLowerCase("ca");
    if (views.has(key)) continue;
    views.add(key);
    result.push(cleaned);
  }
  return result.toSorted();
}
