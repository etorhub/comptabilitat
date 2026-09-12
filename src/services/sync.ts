/**
 * Orquestracio d'una importacio.
 *
 * Aqui nomes hi ha qui mana a qui i el registre del que ha passat: cada intent
 * queda a `sync_runs`, amb quants moviments s'han inserit i actualitzat i quin
 * error hi ha hagut. Aixo es el que permet veure si el limit de crides del
 * banc s'esta atansant.
 *
 * El consentiment es a `consent.ts` i la feina de debo, a `import.ts`.
 */

import { and, eq, gte, lt } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  accounts,
  bankConnections,
  syncRuns,
  type BankConnection,
  type SyncRun,
  type SyncTrigger,
} from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { SessionExpiredError } from "../lib/enablebanking/errors.ts";
import { addDays, todayLocal } from "../lib/time.ts";
import { createAlert } from "./alerts.ts";
import {
  removeTransactions,
  startDateMonthsAgo,
  saveTransactions,
  saveBalances,
} from "./import.ts";

/** Passades aquestes hores, una importacio «en marxa» no ho esta pas. */
const HORES_FINS_A_DONAR_PER_MORTA = 2;

export interface SyncResult {
  connectionId: number;
  accountList: number;
  inserits: number;
  actualitzats: number;
  errors: string[];
}

export async function sincronitzaConnection(
  connection: BankConnection,
  options: { trigger?: SyncTrigger; daysBack?: number | null } = {},
): Promise<SyncResult> {
  const run = await openImport(connection, options.trigger ?? "scheduled");
  return runTheImport(connection, run, options);
}

/**
 * Obre la fila de `sync_runs` i prou.
 *
 * Va a part perque qui llança la importacio en segon pla pugui tenir la fila
 * **abans** de contestar. Si no, no hi ha manera de dibuixar l'estat sense
 * endevinar quan hi sera: aixo abans es resolia amb una espera de 150 ms i una
 * creuada de dits, i si la inserció trigava mes, el fragment sortia sense el
 * `hx-trigger` i el sondeig no arrencava mai.
 */
export async function openImport(
  connection: BankConnection,
  trigger: SyncTrigger,
): Promise<SyncRun | undefined> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      connectionId: connection.id,
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
  return run;
}

/** La importacio de debo, sobre una fila de `sync_runs` que ja existeix. */
export async function runTheImport(
  connection: BankConnection,
  run: SyncRun | undefined,
  options: { daysBack?: number | null } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    connectionId: connection.id,
    accountList: 0,
    inserits: 0,
    actualitzats: 0,
    errors: [],
  };

  const finish = async (state: "success" | "partial" | "failed", error = "") => {
    if (run) {
      await db
        .update(syncRuns)
        .set({
          status: state,
          finishedAt: new Date(),
          accountsSynced: result.accountList,
          transactionsInserted: result.inserits,
          transactionsUpdated: result.actualitzats,
          error: error.slice(0, 2000),
        })
        .where(eq(syncRuns.id, run.id));
    }
  };

  try {
    const client = new EnableBankingClient();

    const accountList = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.connectionId, connection.id), eq(accounts.isActive, true)));

    for (const account of accountList) {
      try {
        const dateFrom =
          options.daysBack != null
            ? addDays(todayLocal(), -options.daysBack)
            : account.lastBookedDate !== null
              ? addDays(account.lastBookedDate, -config.ebResyncOverlapDays)
              : startDateMonthsAgo(config.ebInitialHistoryMonths);

        const { items, truncat } = await removeTransactions(client, account, dateFrom);
        const parcial = await saveTransactions(account, items, truncat);
        await saveBalances(client, account);

        result.accountList += 1;
        result.inserits += parcial.inserits;
        result.actualitzats += parcial.actualitzats;
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`compte ${account.id}: ${message}`);
      }
    }

    await db
      .update(bankConnections)
      .set({ lastSyncAt: new Date(), lastError: result.errors.join("; ").slice(0, 2000) })
      .where(eq(bankConnections.id, connection.id));

    await finish(result.errors.length > 0 ? "partial" : "success", result.errors.join("; "));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof SessionExpiredError) {
      // El consentiment ha caducat: cal tornar a autoritzar amb SCA.
      await db
        .update(bankConnections)
        .set({ status: "expired", lastError: message })
        .where(eq(bankConnections.id, connection.id));

      await createAlert({
        type: "consent_expired",
        ledgerId: null,
        dedupKey: `consent-expired:${connection.id}:${todayLocal()}`,
        title: `${connection.aspspName}: el consentiment ha caducat`,
        body: "Cal tornar a autoritzar el banc des de Connexions per continuar important moviments.",
        severity: "critical",
        payload: { connection_id: connection.id },
      });
    } else {
      await db
        .update(bankConnections)
        .set({ status: "error", lastError: message })
        .where(eq(bankConnections.id, connection.id));

      await createAlert({
        type: "sync_failed",
        ledgerId: null,
        dedupKey: `sync-failed:${connection.id}:${todayLocal()}`,
        title: `${connection.aspspName}: la sincronitzacio ha fallat`,
        body: message,
        severity: "warning",
        payload: { connection_id: connection.id },
      });
    }

    result.errors.push(message);
    await finish("failed", message);
    return result;
  }
}

/**
 * Tanca les importacions que van quedar penjades.
 *
 * La importacio corre en segon pla dins del proces del servidor. Si el
 * contenidor es reinicia enmig, la fila de `sync_runs` es queda en `running`
 * per sempre —no hi ha ningu que la pugui acabar— i la pagina de connexions es
 * queda **sondejant cada dos segons, per sempre i per a tothom qui la miri**,
 * perque el fragment nomes s'atura quan l'estat es terminal.
 *
 * Tambe serveix de porta: mentre n'hi hagi una de viva, no se'n comença cap
 * altra de la mateixa connexio.
 */
export async function closeStuckImports(): Promise<number> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);

  const tancades = await db
    .update(syncRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "La importacio es va quedar a mitges (el servidor es va aturar).",
    })
    .where(and(eq(syncRuns.status, "running"), lt(syncRuns.startedAt, limit)))
    .returning({ id: syncRuns.id });

  if (tancades.length > 0) {
    console.warn(`[sync] ${tancades.length} importacions penjades donades per fallides`);
  }
  return tancades.length;
}

/** Si ja n'hi ha una de viva per a aquesta connexio, no se'n comença cap altra. */
export async function alreadySyncing(connectionId: number): Promise<boolean> {
  const limit = new Date(Date.now() - HORES_FINS_A_DONAR_PER_MORTA * 60 * 60 * 1000);
  const [viva] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.connectionId, connectionId),
        eq(syncRuns.status, "running"),
        gte(syncRuns.startedAt, limit),
      ),
    )
    .limit(1);
  return viva !== undefined;
}

/**
 * Tanca ara mateix les importacions obertes d'aquest proces.
 *
 * La crida l'aturada endreçada del servidor: si s'atura mentre n'hi ha una en
 * marxa, val mes deixar-la marcada com a fallida que no pas en `running`, on
 * es quedaria fent sondejar la pagina fins que passes el manteniment.
 */
export async function closeOpenImports(): Promise<number> {
  const tancades = await db
    .update(syncRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "El servidor s'ha aturat enmig de la importacio.",
    })
    .where(eq(syncRuns.status, "running"))
    .returning({ id: syncRuns.id });

  if (tancades.length > 0) {
    console.info(`[sync] ${tancades.length} importacions marcades com a interrompudes`);
  }
  return tancades.length;
}
