/**
 * Importacio de moviments des d'Enable Banking.
 *
 * Traduccio de `backend/app/services/sync.py`. Les dues coses que fan que
 * sincronitzar dues vegades no faci malbe res:
 *
 *   1. **La clau de deduplicacio** (`dedupKey`), que reconeix el que ja hi ha.
 *   2. **La reconciliacio dels pendents**: quan un apunt pendent es consolida,
 *      es reaprofita la mateixa fila en lloc de fer-ne una de nova, de manera
 *      que la categoria que hi hagi posat una persona es conserva.
 */

import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  accounts,
  balances,
  bankConnections,
  syncRuns,
  transactions,
  type Account,
  type BankConnection,
  type SyncTrigger,
} from "../db/schema/index.ts";
import { config, ebRedirectUrl } from "../lib/config.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { DateRangeError, SessionExpiredError } from "../lib/enablebanking/errors.ts";
import {
  dedupKey,
  parseAccount,
  parseBalance,
  parseTransaction,
  type MovimentAnalitzat,
} from "../lib/enablebanking/parsing.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { creaAvis } from "./alerts.ts";
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

export interface ResultatSync {
  connectionId: number;
  comptes: number;
  inserits: number;
  actualitzats: number;
  errors: string[];
}

/** Data d'inici per a la primera importacio. */
function dataInicialFaMesos(mesos: number): string {
  return addDays(todayLocal(), -mesos * 31);
}

// --- Autoritzacio ------------------------------------------------------------

function estatAleatori(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Comença l'autoritzacio i torna la URL del banc.
 *
 * Si es passa una connexio, es una renovacio del consentiment: es conserva la
 * connexio (i per tant els seus comptes, l'espai que tinguin assignat i tot
 * l'historic) i nomes se'n renova la sessio.
 */
export async function comencaAutoritzacio(opcions: {
  aspspName?: string;
  aspspCountry?: string;
  psuType?: string;
  connectionId?: number | null;
  userId: number;
}): Promise<{ authorizationUrl: string; connectionId: number }> {
  const aspspName = opcions.aspspName || config.ebDefaultAspspName;
  const aspspCountry = opcions.aspspCountry || config.ebDefaultAspspCountry;
  const psuType = opcions.psuType || "personal";
  const estat = estatAleatori();

  let connexio: BankConnection | undefined;

  if (opcions.connectionId != null) {
    [connexio] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, opcions.connectionId))
      .limit(1);
  }

  if (connexio) {
    await db
      .update(bankConnections)
      .set({ ebAuthState: estat })
      .where(eq(bankConnections.id, connexio.id));
  } else {
    const [creada] = await db
      .insert(bankConnections)
      .values({
        name: aspspName,
        aspspName,
        aspspCountry,
        psuType,
        ebSessionId: null,
        ebAuthState: estat,
        status: "pending",
        validUntil: null,
        lastSyncAt: null,
        lastError: "",
        createdById: opcions.userId,
      })
      .returning();
    connexio = creada;
  }

  if (!connexio) throw new Error("No s'ha pogut crear la connexio");

  const client = new EnableBankingClient();
  const resposta = await client.startAuthorization({
    aspspName,
    aspspCountry,
    redirectUrl: ebRedirectUrl,
    state: estat,
    psuType,
  });

  const url = resposta.url ?? resposta.authorization_url;
  if (!url) throw new Error("El banc no ha tornat cap adreça d'autoritzacio");

  return { authorizationUrl: url, connectionId: connexio.id };
}

/**
 * Tanca l'autoritzacio amb el codi que torna el banc.
 *
 * Els comptes s'insereixen o s'actualitzen per `eb_account_uid`, de manera que
 * renovar el consentiment **conserva l'espai assignat i l'historic**.
 */
export async function acabaAutoritzacio(codi: string, estat: string): Promise<BankConnection> {
  const [connexio] = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.ebAuthState, estat))
    .limit(1);

  if (!connexio) throw new Error("Estat d'autoritzacio desconegut");

  const client = new EnableBankingClient();
  const sessio = await client.createSession(codi);

  const validUntil = sessio.access?.valid_until ? new Date(sessio.access.valid_until) : null;

  const [actualitzada] = await db
    .update(bankConnections)
    .set({
      ebSessionId: sessio.session_id ?? null,
      // L'estat es d'un sol us.
      ebAuthState: null,
      status: "active",
      validUntil,
      lastError: "",
    })
    .where(eq(bankConnections.id, connexio.id))
    .returning();

  for (const cru of sessio.accounts ?? []) {
    const dades = parseAccount(cru);
    if (!dades.ebAccountUid) continue;

    const [ja] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.ebAccountUid, dades.ebAccountUid))
      .limit(1);

    if (ja) {
      // No es toca `ledgerId`: l'espai assignat es conserva.
      await db
        .update(accounts)
        .set({
          connectionId: connexio.id,
          name: dades.name || ja.name,
          product: dades.product,
          iban: dades.iban || ja.iban,
          currency: dades.currency,
          cashAccountType: dades.cashAccountType,
          usage: dades.usage,
          isActive: true,
          raw: dades.raw,
        })
        .where(eq(accounts.id, ja.id));
    } else {
      await db.insert(accounts).values({
        connectionId: connexio.id,
        ledgerId: null,
        ebAccountUid: dades.ebAccountUid,
        name: dades.name,
        product: dades.product,
        iban: dades.iban,
        currency: dades.currency,
        cashAccountType: dades.cashAccountType,
        usage: dades.usage,
        isActive: true,
        historyStartDate: null,
        lastBookedDate: null,
        raw: dades.raw,
      });
    }
  }

  return actualitzada ?? connexio;
}

// --- Importacio --------------------------------------------------------------

/**
 * Baixa els moviments, escurçant la finestra si el banc la rebutja.
 *
 * El Santander no accepta sempre 24 mesos; quan diu que no, es prova amb 12,
 * 6, 3 i 1, i queda escrit al registre quina ha entrat.
 */
async function baixaMoviments(
  client: EnableBankingClient,
  compte: Account,
  dataDes: string,
): Promise<{ items: MovimentAnalitzat[]; usada: string }> {
  const finestres = [dataDes];
  for (const mesos of FALLBACK_WINDOWS_MONTHS) {
    const candidata = dataInicialFaMesos(mesos);
    if (candidata > dataDes && !finestres.includes(candidata)) finestres.push(candidata);
  }

  let ultimError: DateRangeError | null = null;

  for (const candidata of finestres) {
    try {
      const items: MovimentAnalitzat[] = [];
      for await (const cru of client.iterTransactions(compte.ebAccountUid, {
        dateFrom: candidata,
      })) {
        const analitzat = parseTransaction(cru);
        if (analitzat !== null) items.push(analitzat);
      }
      return { items, usada: candidata };
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
async function desaMoviments(
  compte: Account,
  items: MovimentAnalitzat[],
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

  // Els pendents que el banc ja no reporta han desaparegut.
  const caducats = pendents.filter(
    (p) => !vistes.has(p.dedupKey) && p.bookingDate >= inicíFinestra,
  );
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

async function desaSaldos(client: EnableBankingClient, compte: Account): Promise<void> {
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

/**
 * Sincronitza una connexio sencera.
 *
 * Cada intent queda registrat a `sync_runs`, amb quants moviments s'han
 * inserit i actualitzat i quin error hi ha hagut, si n'hi ha. Aixo es el que
 * permet veure si el limit de crides del banc s'esta atansant.
 */
export async function sincronitzaConnexio(
  connexio: BankConnection,
  opcions: { trigger?: SyncTrigger; daysBack?: number | null } = {},
): Promise<ResultatSync> {
  const trigger = opcions.trigger ?? "scheduled";

  const [execucio] = await db
    .insert(syncRuns)
    .values({
      connectionId: connexio.id,
      trigger,
      status: "running",
      startedAt: new Date(),
      finishedAt: null,
      accountsSynced: 0,
      transactionsInserted: 0,
      transactionsUpdated: 0,
      error: "",
    })
    .returning();

  const resultat: ResultatSync = {
    connectionId: connexio.id,
    comptes: 0,
    inserits: 0,
    actualitzats: 0,
    errors: [],
  };

  const acaba = async (estat: "success" | "partial" | "failed", error = "") => {
    if (execucio) {
      await db
        .update(syncRuns)
        .set({
          status: estat,
          finishedAt: new Date(),
          accountsSynced: resultat.comptes,
          transactionsInserted: resultat.inserits,
          transactionsUpdated: resultat.actualitzats,
          error: error.slice(0, 2000),
        })
        .where(eq(syncRuns.id, execucio.id));
    }
  };

  try {
    const client = new EnableBankingClient();

    const comptes = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.connectionId, connexio.id), eq(accounts.isActive, true)));

    for (const compte of comptes) {
      try {
        const dataDes =
          opcions.daysBack != null
            ? addDays(todayLocal(), -opcions.daysBack)
            : compte.lastBookedDate !== null
              ? addDays(compte.lastBookedDate, -config.ebResyncOverlapDays)
              : dataInicialFaMesos(config.ebInitialHistoryMonths);

        const { items } = await baixaMoviments(client, compte, dataDes);
        const parcial = await desaMoviments(compte, items);
        await desaSaldos(client, compte);

        resultat.comptes += 1;
        resultat.inserits += parcial.inserits;
        resultat.actualitzats += parcial.actualitzats;
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        const missatge = error instanceof Error ? error.message : String(error);
        resultat.errors.push(`compte ${compte.id}: ${missatge}`);
      }
    }

    await db
      .update(bankConnections)
      .set({ lastSyncAt: new Date(), lastError: resultat.errors.join("; ").slice(0, 2000) })
      .where(eq(bankConnections.id, connexio.id));

    await acaba(resultat.errors.length > 0 ? "partial" : "success", resultat.errors.join("; "));
    return resultat;
  } catch (error) {
    const missatge = error instanceof Error ? error.message : String(error);

    if (error instanceof SessionExpiredError) {
      // El consentiment ha caducat: cal tornar a autoritzar amb SCA.
      await db
        .update(bankConnections)
        .set({ status: "expired", lastError: missatge })
        .where(eq(bankConnections.id, connexio.id));

      await creaAvis({
        type: "consent_expired",
        ledgerId: null,
        dedupKey: `consent-expired:${connexio.id}:${todayLocal()}`,
        title: `${connexio.aspspName}: el consentiment ha caducat`,
        body: "Cal tornar a autoritzar el banc des de Connexions per continuar important moviments.",
        severity: "critical",
        payload: { connection_id: connexio.id },
      });
    } else {
      await db
        .update(bankConnections)
        .set({ status: "error", lastError: missatge })
        .where(eq(bankConnections.id, connexio.id));

      await creaAvis({
        type: "sync_failed",
        ledgerId: null,
        dedupKey: `sync-failed:${connexio.id}:${todayLocal()}`,
        title: `${connexio.aspspName}: la sincronitzacio ha fallat`,
        body: missatge,
        severity: "warning",
        payload: { connection_id: connexio.id },
      });
    }

    resultat.errors.push(missatge);
    await acaba("failed", missatge);
    return resultat;
  }
}

/**
 * Nomes per a les proves: desa un lot de moviments sense passar per la xarxa.
 *
 * La part que decideix de la importacio es aquesta; el que hi ha al voltant es
 * baixar-los del banc, que a les proves no es fa.
 */
export const desaMovimentsPerAProves = desaMoviments;

/**
 * Avisa dels consentiments a punt de caducar i marca els que ja ho han fet.
 *
 * Sota PSD2 caduquen cada 90 dies i no hi ha manera d'evitar-ho: l'unic que es
 * pot fer es avisar a temps, 7, 3 i 1 dia abans.
 */
export async function comprovaConsentiments(): Promise<number> {
  const avui = todayLocal();
  let creats = 0;

  const connexions = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.status, "active"));

  for (const connexio of connexions) {
    if (connexio.validUntil === null) continue;

    const dies = daysBetween(avui, connexio.validUntil.toISOString().slice(0, 10));

    if (dies < 0) {
      await db
        .update(bankConnections)
        .set({ status: "expired" })
        .where(eq(bankConnections.id, connexio.id));
      continue;
    }

    if (![7, 3, 1].includes(dies)) continue;

    const creat = await creaAvis({
      type: "consent_expiring",
      ledgerId: null,
      dedupKey: `consent-expiring:${connexio.id}:${dies}`,
      title: `${connexio.aspspName}: el consentiment caduca en ${dies} ${dies === 1 ? "dia" : "dies"}`,
      body: "Cal tornar a autoritzar el banc des de Connexions abans que caduqui, o la importacio s'aturara.",
      severity: dies <= 1 ? "critical" : "warning",
      payload: { connection_id: connexio.id, days_left: dies },
    });
    if (creat) creats += 1;
  }

  return creats;
}
