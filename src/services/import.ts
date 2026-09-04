/**
 * Baixar els moviments del banc i desar-los.
 *
 * Les dues coses que fan que importar dues vegades no faci malbe res:
 *
 *   1. **La clau de deduplicacio** (`dedupKey`), que reconeix el que ja hi ha.
 *   2. **La reconciliacio dels pendents**: quan un apunt pendent es consolida,
 *      es reaprofita la mateixa fila en lloc de fer-ne una de nova, de manera
 *      que la categoria que hi hagi posat una persona es conserva.
 *
 * Qui ho orquestra i qui en porta el registre es `sync.ts`.
 */

import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, balances, transactions, type Account } from "../db/schema/index.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { DateRangeError } from "../lib/enablebanking/errors.ts";
import {
  dedupKey,
  parseBalance,
  parseTransaction,
  type MovimentAnalitzat,
} from "../lib/enablebanking/parsing.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { classificaMoviment } from "./classification.ts";
import { obteOCreaComerc } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";
import { reglesActives } from "./rules.ts";

/** Marge per aparellar un pendent amb el seu apunt definitiu. */
const PENDING_MATCH_DAYS = 5;
/** Finestres alternatives (en mesos) quan el banc rebutja el periode demanat. */
const FALLBACK_WINDOWS_MONTHS = [24, 12, 6, 3, 1];

export interface ResultatCompte {
  accountId: number;
  inserits: number;
  actualitzats: number;
  esborrats: number;
  error: string;
}

/** La data d'inici d'una finestra de tants mesos enrere. */
export function dataInicialFaMesos(mesos: number): string {
  return addDays(todayLocal(), -Math.round(mesos * 30.4));
}

// --- Importacio --------------------------------------------------------------

/**
 * Baixa els moviments, escurçant la finestra si el banc la rebutja.
 *
 * El Santander no accepta sempre 24 mesos; quan diu que no, es prova amb 12,
 * 6, 3 i 1, i queda escrit al registre quina ha entrat.
 */
export async function baixaMoviments(
  client: EnableBankingClient,
  compte: Account,
  dataDes: string,
): Promise<{ items: MovimentAnalitzat[]; usada: string; truncat: boolean }> {
  const finestres = [dataDes];
  for (const mesos of FALLBACK_WINDOWS_MONTHS) {
    const candidata = dataInicialFaMesos(mesos);
    if (candidata > dataDes && !finestres.includes(candidata)) finestres.push(candidata);
  }

  let ultimError: DateRangeError | null = null;

  for (const candidata of finestres) {
    try {
      const items: MovimentAnalitzat[] = [];
      // Es recorre a ma per poder llegir el valor de retorn del generador,
      // que diu si la llista s'ha quedat curta.
      const pagines = client.iterTransactions(compte.ebAccountUid, { dateFrom: candidata });
      let pas = await pagines.next();
      while (pas.done !== true) {
        const analitzat = parseTransaction(pas.value);
        if (analitzat !== null) items.push(analitzat);
        pas = await pagines.next();
      }
      return { items, usada: candidata, truncat: pas.value };
    } catch (error) {
      if (error instanceof DateRangeError) {
        console.warn(
          `[sync] compte ${compte.id}: el banc rebutja la finestra des de ${candidata} (${error.message})`,
        );
        ultimError = error;
        continue;
      }
      throw error;
    }
  }

  throw ultimError ?? new DateRangeError("Cap finestra de dates acceptada");
}

/** Camps que el banc pot canviar d'un moviment que ja teniem. */
function calActualitzar(
  actual: {
    status: string;
    bookingDate: string;
    valueDate: string | null;
    amount: string;
    description: string;
    counterparty: string;
  },
  nou: MovimentAnalitzat,
): boolean {
  return (
    actual.status !== nou.status ||
    actual.bookingDate !== nou.bookingDate ||
    actual.valueDate !== nou.valueDate ||
    actual.amount !== nou.amount ||
    actual.description !== nou.description ||
    actual.counterparty !== nou.counterparty
  );
}

/**
 * Desa els moviments d'un compte.
 *
 * Aqui hi ha la reconciliacio dels pendents: un apunt pendent que es
 * consolida **reaprofita la fila que ja hi havia**, de manera que la
 * categoria que hi hagi posat una persona no es perd.
 */
export async function desaMoviments(
  compte: Account,
  items: MovimentAnalitzat[],
  /** Si el banc no ho ha donat tot, no es pot deduir res del que hi falta. */
  llistaIncompleta = false,
): Promise<ResultatCompte> {
  const resultat: ResultatCompte = {
    accountId: compte.id,
    inserits: 0,
    actualitzats: 0,
    esborrats: 0,
    error: "",
  };
  if (items.length === 0) return resultat;

  const dataMinima = items.reduce((a, b) =>
    a.bookingDate < b.bookingDate ? a : b,
  ).bookingDate;
  const inicíFinestra = addDays(dataMinima, -PENDING_MATCH_DAYS);

  const existents = await db
    .select({
      id: transactions.id,
      dedupKey: transactions.dedupKey,
      status: transactions.status,
      bookingDate: transactions.bookingDate,
      valueDate: transactions.valueDate,
      amount: transactions.amount,
      description: transactions.description,
      counterparty: transactions.counterparty,
    })
    .from(transactions)
    .where(
      and(eq(transactions.accountId, compte.id), gte(transactions.bookingDate, inicíFinestra)),
    );

  const perClau = new Map(existents.map((e) => [e.dedupKey, e]));
  let pendents = existents.filter((e) => e.status === "pending");
  const vistes = new Set<string>();

  // Es carreguen un sol cop: la mateixa llista serveix per a tots els moviments.
  const regles = compte.ledgerId === null ? [] : await reglesActives(compte.ledgerId);

  for (const item of items) {
    const clau = dedupKey(item);
    vistes.add(clau);

    const actual = perClau.get(clau);
    if (actual !== undefined) {
      if (calActualitzar(actual, item)) {
        await db
          .update(transactions)
          .set({
            status: item.status,
            bookingDate: item.bookingDate,
            valueDate: item.valueDate,
            amount: item.amount,
            description: item.description,
            counterparty: item.counterparty,
            raw: item.raw,
          })
          .where(eq(transactions.id, actual.id));
        resultat.actualitzats += 1;
      }
      continue;
    }

    // Un apunt pendent que es consolida no ha de duplicar-se.
    if (item.status === "booked") {
      const aparellat = pendents.find(
        (p) =>
          p.amount === item.amount &&
          Math.abs(daysBetween(p.bookingDate, item.bookingDate)) <= PENDING_MATCH_DAYS,
      );

      if (aparellat !== undefined) {
        pendents = pendents.filter((p) => p.id !== aparellat.id);
        perClau.delete(aparellat.dedupKey);

        await db
          .update(transactions)
          .set({
            dedupKey: clau,
            entryReference: item.entryReference,
            transactionId: item.transactionId,
            status: item.status,
            bookingDate: item.bookingDate,
            valueDate: item.valueDate,
            amount: item.amount,
            description: item.description,
            counterparty: item.counterparty,
            raw: item.raw,
          })
          .where(eq(transactions.id, aparellat.id));

        perClau.set(clau, { ...aparellat, dedupKey: clau });
        resultat.actualitzats += 1;
        continue;
      }
    }

    const [creat] = await db
      .insert(transactions)
      .values({
        accountId: compte.id,
        ledgerId: compte.ledgerId,
        entryReference: item.entryReference,
        transactionId: item.transactionId,
        dedupKey: clau,
        source: "enablebanking",
        bookingDate: item.bookingDate,
        valueDate: item.valueDate,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        description: item.description,
        normalizedDescription: "",
        counterparty: item.counterparty,
        bankTransactionCode: item.bankTransactionCode,
        merchantId: null,
        categoryId: null,
        categorySource: "none",
        categoryConfidence: null,
        needsReview: false,
        appliedRuleId: null,
        transferGroupId: null,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: item.raw,
      })
      .returning({ id: transactions.id });

    if (!creat) continue;

    // Nom normalitzat, comerç i categoria.
    const [normalitzat, mostrar] = normalizeDescription(item.description, item.counterparty);
    let merchantId: number | null = null;

    if (compte.ledgerId !== null && normalitzat) {
      const comerc = await obteOCreaComerc(
        compte.ledgerId,
        normalitzat,
        mostrar,
        item.bookingDate,
      );
      merchantId = comerc?.id ?? null;
    }

    await db
      .update(transactions)
      .set({ normalizedDescription: normalitzat.slice(0, 200), merchantId })
      .where(eq(transactions.id, creat.id));

    await classificaMoviment(
      {
        id: creat.id,
        ledgerId: compte.ledgerId,
        description: item.description,
        normalizedDescription: normalitzat,
        counterparty: item.counterparty,
        amount: item.amount,
        bankTransactionCode: item.bankTransactionCode,
        accountId: compte.id,
        merchantId,
        categorySource: "none",
        tags: [],
      },
      regles,
    );

    perClau.set(clau, {
      id: creat.id,
      dedupKey: clau,
      status: item.status,
      bookingDate: item.bookingDate,
      valueDate: item.valueDate,
      amount: item.amount,
      description: item.description,
      counterparty: item.counterparty,
    });
    resultat.inserits += 1;
  }

  // Els pendents que el banc ja no reporta han desaparegut. Aixo nomes es pot
  // deduir si el banc ho ha donat **tot**: amb una llista escapçada, «no hi
  // es» vol dir «no ha arribat», i esborrariem moviments vius amb les seves
  // notes, les etiquetes i la categoria que hi hagues posat algu.
  const caducats = llistaIncompleta
    ? []
    : pendents.filter((p) => !vistes.has(p.dedupKey) && p.bookingDate >= inicíFinestra);
  if (caducats.length > 0) {
    await db.delete(transactions).where(
      inArray(
        transactions.id,
        caducats.map((p) => p.id),
      ),
    );
    resultat.esborrats = caducats.length;
  }

  // Fins on hem arribat.
  const definitius = items.filter((i) => i.status === "booked").map((i) => i.bookingDate);
  const canvis: Partial<typeof accounts.$inferInsert> = {};

  if (definitius.length > 0) {
    const mesNova = definitius.reduce((a, b) => (a > b ? a : b));
    if (compte.lastBookedDate === null || mesNova > compte.lastBookedDate) {
      canvis.lastBookedDate = mesNova;
    }
  }
  const mesAntiga = items.reduce((a, b) => (a.bookingDate < b.bookingDate ? a : b)).bookingDate;
  if (compte.historyStartDate === null || mesAntiga < compte.historyStartDate) {
    canvis.historyStartDate = mesAntiga;
  }
  if (Object.keys(canvis).length > 0) {
    await db.update(accounts).set(canvis).where(eq(accounts.id, compte.id));
  }

  return resultat;
}

export async function desaSaldos(client: EnableBankingClient, compte: Account): Promise<void> {
  const ara = new Date();

  for (const cru of await client.getBalances(compte.ebAccountUid)) {
    const dades = parseBalance(cru);
    if (dades === null || dades.referenceDate === null) continue;

    const [ja] = await db
      .select({ id: balances.id })
      .from(balances)
      .where(
        and(
          eq(balances.accountId, compte.id),
          eq(balances.balanceType, dades.balanceType),
          eq(balances.referenceDate, dades.referenceDate),
        ),
      )
      .limit(1);

    if (ja) {
      await db
        .update(balances)
        .set({ amount: dades.amount, fetchedAt: ara })
        .where(eq(balances.id, ja.id));
    } else {
      await db.insert(balances).values({
        accountId: compte.id,
        balanceType: dades.balanceType,
        amount: dades.amount,
        currency: dades.currency,
        referenceDate: dades.referenceDate,
        fetchedAt: ara,
      });
    }
  }
}
