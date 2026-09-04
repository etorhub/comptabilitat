/**
 * Moviments: consulta, vista i emmascarament.
 *
 * **L'emmascarament es una funcio de privadesa i s'aplica aqui, no a la
 * plantilla.** Quan un moviment te `display_description`, aquell text
 * substitueix el concepte del banc, i el comerç i la contrapart no es mostren
 * ni es poden cercar.
 *
 * En una arquitectura de fragments aixo es un risc real: qualsevol plantilla
 * nova que dibuixes una fila crua se'l saltaria sense que ningu se n'adones.
 * Per aixo tot passa per `vistaMoviment()` i **de `routes/` no s'importa mai
 * el tipus de la fila sencera**.
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";

import { parsejaConcepte, type TipusOperacio } from "./concepte.ts";
import { teEtiqueta } from "./tags.ts";

import { db } from "../db/client.ts";
import {
  accounts,
  categories,
  merchants,
  transactions,
  type CategorySource,
  type TransactionStatus,
} from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import type { MoneyString } from "../lib/money.ts";

/**
 * Un moviment tal com es pot ensenyar.
 *
 * No hi ha ni `raw`, ni `dedupKey`, ni `entryReference`, ni el concepte del
 * banc quan esta emmascarat. Es l'unic tipus que les plantilles accepten.
 */
export interface MovimentVista {
  id: number;
  accountId: number;
  accountName: string | null;
  bookingDate: string;
  valueDate: string | null;
  amount: MoneyString;
  currency: string;
  status: TransactionStatus;
  /**
   * El text que es pot ensenyar: l'alias si n'hi ha; si no, el concepte del
   * banc ja parsejat (sense targeta ni comissio).
   */
  description: string;
  /**
   * Text bancari sense PAN/targeta/comissio, per al `title` del boto.
   * Null quan hi ha alias (la dada del banc no s'ensenya).
   */
  descriptionHint: string | null;
  /** Darrers 4 digits de la targeta, o null. Mai amb alias. */
  darrers4: string | null;
  /**
   * Tipus d'operacio deduit del concepte. Null quan hi ha alias (no ensenyem
   * metadades del banc).
   */
  tipusOperacio: TipusOperacio | null;
  counterparty: string;
  merchantId: number | null;
  merchantName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  needsReview: boolean;
  transferGroupId: string | null;
  notes: string;
  tags: string[];
  isExcluded: boolean;
  /** Cert si algu n'ha amagat el concepte del banc. */
  isMasked: boolean;
}

/**
 * Columnes explicites. Mai `select()` a seques sobre `transactions`: la fila
 * sencera duu `raw`, que es la resposta del banc amb noms i IBAN.
 */
const CAMPS = {
  id: transactions.id,
  accountId: transactions.accountId,
  accountName: accounts.name,
  bookingDate: transactions.bookingDate,
  valueDate: transactions.valueDate,
  amount: transactions.amount,
  currency: transactions.currency,
  status: transactions.status,
  description: transactions.description,
  displayDescription: transactions.displayDescription,
  normalizedDescription: transactions.normalizedDescription,
  counterparty: transactions.counterparty,
  merchantId: transactions.merchantId,
  merchantName: merchants.displayName,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categorySource: transactions.categorySource,
  categoryConfidence: transactions.categoryConfidence,
  needsReview: transactions.needsReview,
  transferGroupId: transactions.transferGroupId,
  notes: transactions.notes,
  tags: transactions.tags,
  isExcluded: transactions.isExcluded,
} as const;

/**
 * La fila tal com surt de la consulta. Les columnes que venen d'un `left
 * join` poden ser nul·les, de manera que s'escriu a ma en lloc de deduir-la
 * de `CAMPS`: deduir-la amagaria justament aquesta nul·litat.
 */
interface FilaCrua {
  id: number;
  accountId: number;
  accountName: string | null;
  bookingDate: string;
  valueDate: string | null;
  amount: string;
  currency: string;
  status: TransactionStatus;
  description: string;
  displayDescription: string | null;
  normalizedDescription: string;
  counterparty: string;
  merchantId: number | null;
  merchantName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  needsReview: boolean;
  transferGroupId: string | null;
  notes: string;
  tags: string[];
  isExcluded: boolean;
}

/**
 * Converteix una fila en el que es pot ensenyar, aplicant l'emmascarament.
 *
 * **Es l'unica porta.** Si un moviment esta emmascarat, aqui es on el
 * concepte del banc, la contrapart i el comerç desapareixen. Si no, el
 * concepte es parseja nomes per mostrar (sense tocar la BD).
 */
export function vistaMoviment(fila: FilaCrua): MovimentVista {
  const emmascarat = fila.displayDescription !== null && fila.displayDescription !== "";

  if (emmascarat) {
    return {
      id: fila.id,
      accountId: fila.accountId,
      accountName: fila.accountName,
      bookingDate: fila.bookingDate,
      valueDate: fila.valueDate,
      amount: fila.amount,
      currency: fila.currency,
      status: fila.status,
      description: fila.displayDescription ?? "",
      descriptionHint: null,
      darrers4: null,
      tipusOperacio: null,
      counterparty: "",
      merchantId: fila.merchantId,
      merchantName: null,
      categoryId: fila.categoryId,
      categoryName: fila.categoryName,
      categorySource: fila.categorySource,
      categoryConfidence: fila.categoryConfidence,
      needsReview: fila.needsReview,
      transferGroupId: fila.transferGroupId,
      notes: fila.notes,
      tags: fila.tags,
      isExcluded: fila.isExcluded,
      isMasked: true,
    };
  }

  const parsejat = parsejaConcepte(fila.description);
  const hint = parsejat.originalNetejat !== parsejat.titol ? parsejat.originalNetejat : null;

  return {
    id: fila.id,
    accountId: fila.accountId,
    accountName: fila.accountName,
    bookingDate: fila.bookingDate,
    valueDate: fila.valueDate,
    amount: fila.amount,
    currency: fila.currency,
    status: fila.status,
    description: parsejat.titol,
    descriptionHint: hint,
    darrers4: parsejat.darrers4,
    tipusOperacio: parsejat.tipus,
    counterparty: fila.counterparty,
    merchantId: fila.merchantId,
    merchantName: fila.merchantName,
    categoryId: fila.categoryId,
    categoryName: fila.categoryName,
    categorySource: fila.categorySource,
    categoryConfidence: fila.categoryConfidence,
    needsReview: fila.needsReview,
    transferGroupId: fila.transferGroupId,
    notes: fila.notes,
    tags: fila.tags,
    isExcluded: fila.isExcluded,
    isMasked: false,
  };
}

export interface FiltresMoviments {
  accountId: number | null;
  dataDes: string | null;
  dataFins: string | null;
  categoryIds: number[];
  merchantId: number | null;
  cerca: string;
  /** Filtre per etiqueta (insensible a majuscules). Null = sense filtre. */
  etiqueta: string | null;
  /** Tipus d'operacio (OR). Buit = tots. */
  tipusOperacio: TipusOperacio[];
  nomesRevisio: boolean;
  nomesSenseClassificar: boolean;
  incloTraspassos: boolean;
  limit: number;
  offset: number;
}

/** Predicat SQL alineat amb `detectaTipusOperacio` (sobre el concepte cru). */
function predicatTipus(tipus: TipusOperacio): SQL {
  const concepte = transactions.description;
  switch (tipus) {
    case "targeta":
      return sql`(
        ${concepte} ~* '^(COMPRA|PAGO[[:space:]]+(MOVIL|CON[[:space:]]+MOVIL|TARJETA|EN)[[:space:]])'
        OR ${concepte} ~* '\\yTARJ'
      )`;
    case "transferencia":
      return sql`(
        ${concepte} ILIKE 'TRANSFERENCIA%'
        OR ${concepte} ILIKE 'TRANSF %'
        OR ${concepte} ILIKE 'TRANSF.%'
      )`;
    case "bizum":
      return sql`(
        ${concepte} ILIKE 'BIZUM%'
        OR ${concepte} ILIKE 'ENVIO BIZUM%'
      )`;
    case "rebut":
      return sql`(
        ${concepte} ILIKE 'RECIBO%'
        OR ${concepte} ILIKE 'ADEUDO%'
      )`;
    case "altres": {
      // `or()` es tipa com a opcional perque accepta zero arguments; aqui n'hi
      // van quatre de fixos, aixi que no pot ser indefinit. Es comprova en
      // lloc d'afirmar-ho amb un `!`.
      const algun = or(
        predicatTipus("targeta"),
        predicatTipus("transferencia"),
        predicatTipus("bizum"),
        predicatTipus("rebut"),
      );
      if (algun === undefined) throw new Error("predicatTipus: cap predicat");
      return not(algun);
    }
  }
}

function clausulaTipus(tipus: TipusOperacio[]): SQL | undefined {
  if (tipus.length === 0) return undefined;
  // Si hi ha tots els tipus, no cal filtrar.
  if (tipus.length === 5) return undefined;
  return or(...tipus.map(predicatTipus));
}

/**
 * Cerca sobre el text **visible**.
 *
 * Un moviment emmascarat no es pot trobar pel concepte del banc ni per la
 * contrapart: nomes per l'alias que hi ha posat una persona i per les notes.
 * Si no fos aixi, es podria endevinar el que s'ha amagat provant paraules.
 */
function clausulaCerca(patro: string): SQL | undefined {
  return or(
    and(
      isNotNull(transactions.displayDescription),
      or(ilike(transactions.displayDescription, patro), ilike(transactions.notes, patro)),
    ),
    and(
      isNull(transactions.displayDescription),
      or(
        ilike(transactions.description, patro),
        ilike(transactions.normalizedDescription, patro),
        ilike(transactions.counterparty, patro),
        ilike(transactions.notes, patro),
      ),
    ),
  );
}

function condicions(ledgerId: number, f: FiltresMoviments): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(transactions.ledgerId, ledgerId)];

  if (f.accountId !== null) parts.push(eq(transactions.accountId, f.accountId));
  if (f.dataDes) parts.push(gte(transactions.bookingDate, f.dataDes));
  if (f.dataFins) parts.push(lte(transactions.bookingDate, f.dataFins));
  if (f.categoryIds.length > 0) parts.push(inArray(transactions.categoryId, f.categoryIds));
  if (f.merchantId !== null) parts.push(eq(transactions.merchantId, f.merchantId));
  if (f.cerca.trim()) parts.push(clausulaCerca(`%${f.cerca.trim()}%`));
  if (f.etiqueta) parts.push(teEtiqueta(f.etiqueta));
  parts.push(clausulaTipus(f.tipusOperacio));
  if (f.nomesRevisio) parts.push(eq(transactions.needsReview, true));
  if (f.nomesSenseClassificar) parts.push(isNull(transactions.categoryId));
  // Els traspassos entre comptes propis no son ni ingres ni despesa: per
  // defecte no surten.
  if (!f.incloTraspassos) parts.push(isNull(transactions.transferGroupId));

  return and(...parts);
}

export interface PaginaMoviments {
  items: MovimentVista[];
  total: number;
  /** Suma dels moviments que encaixen amb els filtres, no nomes de la pagina. */
  totalImport: MoneyString;
  limit: number;
  offset: number;
}

export async function llistaMoviments(
  ledgerId: number,
  filtres: FiltresMoviments,
): Promise<PaginaMoviments> {
  const on = condicions(ledgerId, filtres);

  const [resum] = await db
    .select({ n: count(), total: sum(transactions.amount) })
    .from(transactions)
    .where(on);

  const files = await db
    .select(CAMPS)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(on)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(filtres.limit)
    .offset(filtres.offset);

  return {
    items: files.map(vistaMoviment),
    total: resum?.n ?? 0,
    totalImport: resum?.total ?? "0.00",
    limit: filtres.limit,
    offset: filtres.offset,
  };
}

/** Un moviment d'aquest espai, ja llest per ensenyar, o 404. */
export async function movimentDeLespai(id: number, ledgerId: number): Promise<MovimentVista> {
  const [fila] = await db
    .select(CAMPS)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.id, id), eq(transactions.ledgerId, ledgerId)))
    .limit(1);

  if (!fila) throw new NotFoundError("Aquest moviment no existeix");
  return vistaMoviment(fila);
}

/** La fila crua, nomes per als serveis. No arriba mai a cap plantilla. */
export async function filaMoviment(id: number, ledgerId: number) {
  const [fila] = await db
    .select({
      id: transactions.id,
      ledgerId: transactions.ledgerId,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      normalizedDescription: transactions.normalizedDescription,
      counterparty: transactions.counterparty,
      transferGroupId: transactions.transferGroupId,
      displayDescription: transactions.displayDescription,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.ledgerId, ledgerId)))
    .limit(1);

  if (!fila) throw new NotFoundError("Aquest moviment no existeix");
  return fila;
}

// --- Safata de revisio -------------------------------------------------------

/** Un moviment per revisar, amb la proposta del model local si n'hi ha. */
export interface ItemRevisio {
  moviment: MovimentVista;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  confidence: number | null;
  rationale: string;
}

/**
 * La cua de revisio.
 *
 * El model local **no confirma res pel seu compte**: quan proposa una
 * categoria, el moviment queda marcat per revisar amb la seva confiança i la
 * seva justificacio, i qui decideix es una persona.
 */
export async function safataRevisio(
  ledgerId: number,
  limit = 50,
  offset = 0,
): Promise<{ items: ItemRevisio[]; total: number }> {
  const on = and(eq(transactions.ledgerId, ledgerId), eq(transactions.needsReview, true));

  const [resum] = await db.select({ n: count() }).from(transactions).where(on);

  const files = await db
    .select(CAMPS)
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(on)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(limit)
    .offset(offset);

  const comercIds = [
    ...new Set(files.map((f) => f.merchantId).filter((x): x is number => x !== null)),
  ];

  // La proposta mes recent de cada comerç.
  const propostes = new Map<
    number,
    {
      categoryId: number | null;
      categoryName: string | null;
      confidence: number | null;
      rationale: string;
    }
  >();
  if (comercIds.length > 0) {
    const { llmSuggestions } = await import("../db/schema/index.ts");
    const suggeriments = await db
      .select({
        merchantId: llmSuggestions.merchantId,
        categoryId: llmSuggestions.suggestedCategoryId,
        categoryName: categories.name,
        confidence: llmSuggestions.confidence,
        rationale: llmSuggestions.rationale,
      })
      .from(llmSuggestions)
      .leftJoin(categories, eq(categories.id, llmSuggestions.suggestedCategoryId))
      .where(inArray(llmSuggestions.merchantId, comercIds))
      .orderBy(llmSuggestions.createdAt);

    for (const s of suggeriments) {
      if (s.merchantId === null) continue;
      propostes.set(s.merchantId, {
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        confidence: s.confidence,
        rationale: s.rationale,
      });
    }
  }

  const items = files.map((fila) => {
    const moviment = vistaMoviment(fila);
    // Si el moviment esta emmascarat, la proposta tambe s'amaga: parla del
    // comerç, que es justament el que no s'ha de veure.
    const proposta = moviment.isMasked
      ? undefined
      : fila.merchantId !== null
        ? propostes.get(fila.merchantId)
        : undefined;

    return {
      moviment,
      suggestedCategoryId: proposta?.categoryId ?? null,
      suggestedCategoryName: proposta?.categoryName ?? null,
      confidence: proposta?.confidence ?? null,
      rationale: proposta?.rationale ?? "",
    };
  });

  return { items, total: resum?.n ?? 0 };
}
