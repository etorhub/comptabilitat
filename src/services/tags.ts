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
export function normalitzaEtiqueta(bruta: string): string {
  const net = bruta.trim().replace(/\s+/g, " ");
  if (net.length === 0) {
    throw new AppError("Cal un nom d'etiqueta", 422);
  }
  if (net.length > LONGITUD_MAX) {
    throw new AppError(`L'etiqueta pot tenir com a molt ${LONGITUD_MAX} caracters`, 422);
  }
  if (net.includes(",")) {
    throw new AppError("L'etiqueta no pot dur comes", 422);
  }
  return net;
}

/** Comparacio sense majuscules ni accents de longitud. */
export function mateixaEtiqueta(a: string, b: string): boolean {
  return a.toLocaleLowerCase("ca") === b.toLocaleLowerCase("ca");
}

/**
 * Si l'espai ja te una etiqueta amb el mateix nom (ignorant majuscules),
 * reutilitza aquella ortografia. Si no, torna el text normalitzat.
 */
export async function ortografiaEspai(ledgerId: number, nom: string): Promise<string> {
  const net = normalitzaEtiqueta(nom);
  const conegudes = await etiquetesEspai(ledgerId);
  const existent = conegudes.find((t) => mateixaEtiqueta(t, net));
  return existent ?? net;
}

/** Totes les etiquetes distintes de l'espai, ordenades. */
export async function etiquetesEspai(ledgerId: number): Promise<string[]> {
  const files = await db.execute<{ etiqueta: string }>(sql`
    select distinct t.etiqueta
    from transactions,
      lateral unnest(tags) as t(etiqueta)
    where ledger_id = ${ledgerId}
      and cardinality(tags) > 0
    order by t.etiqueta
  `);
  return [...files].map((f) => f.etiqueta);
}

export interface ResumEtiqueta {
  nom: string;
  moviments: number;
  ingressos: MoneyString;
  despeses: MoneyString;
  net: MoneyString;
}

/**
 * Llista d'etiquetes amb sumes.
 *
 * Mateix criteri que el llistat de moviments per defecte: sense traspassos
 * entre comptes propis. No filtra `is_excluded` ni `status` com els
 * informes: l'etiqueta es una etiqueta de gestio, no un tros d'informe.
 */
export async function llistaEtiquetes(ledgerId: number): Promise<ResumEtiqueta[]> {
  const files = await db.execute<{
    nom: string;
    moviments: number;
    ingressos: string | null;
    despeses: string | null;
    net: string | null;
  }>(sql`
    select
      t.etiqueta as nom,
      count(*)::int as moviments,
      coalesce(sum(case when amount > 0 then amount else 0 end), 0) as ingressos,
      coalesce(sum(case when amount < 0 then abs(amount) else 0 end), 0) as despeses,
      coalesce(sum(amount), 0) as net
    from transactions,
      lateral unnest(tags) as t(etiqueta)
    where ledger_id = ${ledgerId}
      and transfer_group_id is null
    group by t.etiqueta
    order by t.etiqueta
  `);

  return [...files].map((f) => ({
    nom: f.nom,
    moviments: Number(f.moviments),
    ingressos: toMoneyString(money(f.ingressos)),
    despeses: toMoneyString(money(f.despeses)),
    net: toMoneyString(money(f.net)),
  }));
}

/** Resum d'una etiqueta (insensible a majuscules), o zeros si no n'hi ha. */
export async function resumEtiqueta(ledgerId: number, nom: string): Promise<ResumEtiqueta> {
  const net = normalitzaEtiqueta(nom);
  const totes = await llistaEtiquetes(ledgerId);
  const trobada = totes.find((e) => mateixaEtiqueta(e.nom, net));
  if (trobada) return trobada;
  return {
    nom: net,
    moviments: 0,
    ingressos: "0.00",
    despeses: "0.00",
    net: "0.00",
  };
}

/** Condicio SQL: el moviment duu aquesta etiqueta (ignorant majuscules). */
export function teEtiqueta(nom: string) {
  const net = normalitzaEtiqueta(nom);
  return sql`exists (
    select 1 from unnest(${transactions.tags}) as e(t)
    where lower(e.t) = lower(${net})
  )`;
}

/**
 * Afegeix una etiqueta a un moviment de l'espai.
 *
 * Retorna les etiquetes finals. Si ja la tenia (mateix nom sense majuscules),
 * no duplica.
 */
export async function afegeixEtiqueta(
  movimentId: number,
  ledgerId: number,
  nomBrut: string,
): Promise<string[]> {
  const [fila] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, movimentId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquest moviment no existeix");

  const canònica = await ortografiaEspai(ledgerId, nomBrut);
  const actuals = fila.tags ?? [];
  if (actuals.some((t) => mateixaEtiqueta(t, canònica))) {
    return actuals.toSorted();
  }

  const noves = [...actuals, canònica].toSorted();
  await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, movimentId));
  return noves;
}

/** Treu una etiqueta d'un moviment (insensible a majuscules). */
export async function treuEtiqueta(
  movimentId: number,
  ledgerId: number,
  nomBrut: string,
): Promise<string[]> {
  const net = normalitzaEtiqueta(nomBrut);
  const [fila] = await db
    .select({ id: transactions.id, tags: transactions.tags })
    .from(transactions)
    .where(and(eq(transactions.id, movimentId), eq(transactions.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquest moviment no existeix");

  const noves = (fila.tags ?? []).filter((t) => !mateixaEtiqueta(t, net)).toSorted();
  await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, movimentId));
  return noves;
}

/**
 * Afegeix la mateixa etiqueta a un lot de moviments de l'espai.
 *
 * **Tot o res:** si algun id no es de l'espai, no se'n toca cap.
 */
export async function afegeixEtiquetaEnBloc(
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

  const canònica = await ortografiaEspai(ledgerId, nomBrut);
  let tocats = 0;
  for (const fila of meus) {
    const actuals = fila.tags ?? [];
    if (actuals.some((t) => mateixaEtiqueta(t, canònica))) continue;
    const noves = [...actuals, canònica].toSorted();
    await db.update(transactions).set({ tags: noves }).where(eq(transactions.id, fila.id));
    tocats += 1;
  }
  return tocats;
}

/**
 * Treu l'etiqueta de **tots** els moviments de l'espai.
 *
 * Retorna quants n'han quedat afectats.
 */
export async function esborraEtiquetaDeLespai(
  ledgerId: number,
  nomBrut: string,
): Promise<number> {
  const net = normalitzaEtiqueta(nomBrut);

  const afectats = await db.execute<{ id: number }>(sql`
    select id from transactions
    where ledger_id = ${ledgerId}
      and exists (
        select 1 from unnest(tags) as e(t)
        where lower(e.t) = lower(${net})
      )
  `);

  const quants = [...afectats].length;
  if (quants === 0) return 0;

  await db.execute(sql`
    update transactions
    set tags = coalesce((
      select array_agg(e.t order by e.t)
      from unnest(tags) as e(t)
      where lower(e.t) <> lower(${net})
    ), '{}'::varchar[])
    where ledger_id = ${ledgerId}
      and exists (
        select 1 from unnest(tags) as e(t)
        where lower(e.t) = lower(${net})
      )
  `);

  return quants;
}

/** Parseja una llista separada per comes (formulari de regles). */
export function parsejaLlistaEtiquetes(bruta: string): string[] {
  if (!bruta.trim()) return [];
  const vistes = new Set<string>();
  const resultat: string[] = [];
  for (const tros of bruta.split(",")) {
    const net = tros.trim().replace(/\s+/g, " ");
    if (!net) continue;
    if (net.length > LONGITUD_MAX) {
      throw new AppError(`Cada etiqueta pot tenir com a molt ${LONGITUD_MAX} caracters`, 422);
    }
    const clau = net.toLocaleLowerCase("ca");
    if (vistes.has(clau)) continue;
    vistes.add(clau);
    resultat.push(net);
  }
  return resultat.toSorted();
}
