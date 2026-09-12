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
  type TransactionAnalyzed,
} from "../lib/enablebanking/parsing.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { classifyTransaction } from "./classification.ts";
import { resolveCounterparty } from "./contraparts.ts";

/** Marge per aparellar un pendent amb el seu apunt definitiu. */
const PENDING_MATCH_DAYS = 5;
/** Finestres alternatives (en mesos) quan el banc rebutja el periode demanat. */
const FALLBACK_WINDOWS_MONTHS = [24, 12, 6, 3, 1];

export interface AccountResult {
  accountId: number;
  inserits: number;
  actualitzats: number;
  esborrats: number;
  error: string;
}

/** La data d'inici d'una finestra de tants mesos enrere. */
export function startDateMonthsAgo(months: number): string {
  return addDays(todayLocal(), -Math.round(months * 30.4));
}

// --- Importacio --------------------------------------------------------------

/**
 * Baixa els moviments, escurçant la finestra si el banc la rebutja.
 *
 * El Santander no accepta sempre 24 mesos; quan diu que no, es prova amb 12,
 * 6, 3 i 1, i queda escrit al registre quina ha entrat.
 */
export async function removeTransactions(
  client: EnableBankingClient,
  account: Account,
  dateFrom: string,
): Promise<{ items: TransactionAnalyzed[]; usada: string; truncat: boolean }> {
  const finestres = [dateFrom];
  for (const months of FALLBACK_WINDOWS_MONTHS) {
    const candidata = startDateMonthsAgo(months);
    if (candidata > dateFrom && !finestres.includes(candidata)) finestres.push(candidata);
  }

  let lastError: DateRangeError | null = null;

  for (const candidata of finestres) {
    try {
      const items: TransactionAnalyzed[] = [];
      // Es recorre a ma per poder llegir el valor de retorn del generador,
      // que diu si la llista s'ha quedat curta.
      const pages = client.iterTransactions(account.ebAccountUid, { dateFrom: candidata });
      let step = await pages.next();
      while (step.done !== true) {
        const analyzed = parseTransaction(step.value);
        if (analyzed !== null) items.push(analyzed);
        step = await pages.next();
      }
      return { items, usada: candidata, truncat: step.value };
    } catch (error) {
      if (error instanceof DateRangeError) {
        console.warn(
          `[sync] compte ${account.id}: el banc rebutja la finestra des de ${candidata} (${error.message})`,
        );
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new DateRangeError("Cap finestra de dates acceptada");
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
  fresh: TransactionAnalyzed,
): boolean {
  return (
    actual.status !== fresh.status ||
    actual.bookingDate !== fresh.bookingDate ||
    actual.valueDate !== fresh.valueDate ||
    actual.amount !== fresh.amount ||
    actual.description !== fresh.description ||
    actual.counterparty !== fresh.counterparty
  );
}

/**
 * Desa els moviments d'un compte.
 *
 * Aqui hi ha la reconciliacio dels pendents: un apunt pendent que es
 * consolida **reaprofita la fila que ja hi havia**, de manera que la
 * categoria que hi hagi posat una persona no es perd.
 */
export async function saveTransactions(
  account: Account,
  items: TransactionAnalyzed[],
  /** Si el banc no ho ha donat tot, no es pot deduir res del que hi falta. */
  llistaIncompleta = false,
): Promise<AccountResult> {
  const result: AccountResult = {
    accountId: account.id,
    inserits: 0,
    actualitzats: 0,
    esborrats: 0,
    error: "",
  };
  if (items.length === 0) return result;

  const dateMinima = items.reduce((a, b) =>
    a.bookingDate < b.bookingDate ? a : b,
  ).bookingDate;
  const inicíFinestra = addDays(dateMinima, -PENDING_MATCH_DAYS);

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
      and(eq(transactions.accountId, account.id), gte(transactions.bookingDate, inicíFinestra)),
    );

  const byKey = new Map(existents.map((e) => [e.dedupKey, e]));
  let pending = existents.filter((e) => e.status === "pending");
  const views = new Set<string>();

  for (const item of items) {
    const key = dedupKey(item);
    views.add(key);

    const actual = byKey.get(key);
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
        result.actualitzats += 1;
      }
      continue;
    }

    // Un apunt pendent que es consolida no ha de duplicar-se.
    if (item.status === "booked") {
      const matched = pending.find(
        (p) =>
          p.amount === item.amount &&
          Math.abs(daysBetween(p.bookingDate, item.bookingDate)) <= PENDING_MATCH_DAYS,
      );

      if (matched !== undefined) {
        pending = pending.filter((p) => p.id !== matched.id);
        byKey.delete(matched.dedupKey);

        await db
          .update(transactions)
          .set({
            dedupKey: key,
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
          .where(eq(transactions.id, matched.id));

        byKey.set(key, { ...matched, dedupKey: key });
        result.actualitzats += 1;
        continue;
      }
    }

    const [creat] = await db
      .insert(transactions)
      .values({
        accountId: account.id,
        ledgerId: account.ledgerId,
        entryReference: item.entryReference,
        transactionId: item.transactionId,
        dedupKey: key,
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
    let merchantId: number | null = null;
    let normalitzat = "";

    if (account.ledgerId !== null) {
      const counterparty = await resolveCounterparty(account.ledgerId, {
        description: item.description,
        counterparty: item.counterparty,
        bookingDate: item.bookingDate,
      });
      merchantId = counterparty.merchantId;
      normalitzat = counterparty.normalizedKey;
    }

    await db
      .update(transactions)
      .set({ normalizedDescription: normalitzat.slice(0, 200), merchantId })
      .where(eq(transactions.id, creat.id));

    await classifyTransaction({
      id: creat.id,
      ledgerId: account.ledgerId,
      merchantId,
      categorySource: "none",
    });

    byKey.set(key, {
      id: creat.id,
      dedupKey: key,
      status: item.status,
      bookingDate: item.bookingDate,
      valueDate: item.valueDate,
      amount: item.amount,
      description: item.description,
      counterparty: item.counterparty,
    });
    result.inserits += 1;
  }

  // Els pendents que el banc ja no reporta han desaparegut. Aixo nomes es pot
  // deduir si el banc ho ha donat **tot**: amb una llista escapçada, «no hi
  // es» vol dir «no ha arribat», i esborrariem moviments vius amb les seves
  // notes, les etiquetes i la categoria que hi hagues posat algu.
  const caducats = llistaIncompleta
    ? []
    : pending.filter((p) => !views.has(p.dedupKey) && p.bookingDate >= inicíFinestra);
  if (caducats.length > 0) {
    await db.delete(transactions).where(
      inArray(
        transactions.id,
        caducats.map((p) => p.id),
      ),
    );
    result.esborrats = caducats.length;
  }

  // Fins on hem arribat.
  const definitius = items.filter((i) => i.status === "booked").map((i) => i.bookingDate);
  const canvis: Partial<typeof accounts.$inferInsert> = {};

  if (definitius.length > 0) {
    const newer = definitius.reduce((a, b) => (a > b ? a : b));
    if (account.lastBookedDate === null || newer > account.lastBookedDate) {
      canvis.lastBookedDate = newer;
    }
  }
  const older = items.reduce((a, b) => (a.bookingDate < b.bookingDate ? a : b)).bookingDate;
  if (account.historyStartDate === null || older < account.historyStartDate) {
    canvis.historyStartDate = older;
  }
  if (Object.keys(canvis).length > 0) {
    await db.update(accounts).set(canvis).where(eq(accounts.id, account.id));
  }

  return result;
}

export async function saveBalances(
  client: EnableBankingClient,
  account: Account,
): Promise<void> {
  const ara = new Date();

  for (const raw of await client.getBalances(account.ebAccountUid)) {
    const data = parseBalance(raw);
    if (data === null || data.referenceDate === null) continue;

    const [ja] = await db
      .select({ id: balances.id })
      .from(balances)
      .where(
        and(
          eq(balances.accountId, account.id),
          eq(balances.balanceType, data.balanceType),
          eq(balances.referenceDate, data.referenceDate),
        ),
      )
      .limit(1);

    if (ja) {
      await db
        .update(balances)
        .set({ amount: data.amount, fetchedAt: ara })
        .where(eq(balances.id, ja.id));
    } else {
      await db.insert(balances).values({
        accountId: account.id,
        balanceType: data.balanceType,
        amount: data.amount,
        currency: data.currency,
        referenceDate: data.referenceDate,
        fetchedAt: ara,
      });
    }
  }
}
