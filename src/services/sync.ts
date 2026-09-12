/**
 * Orchestration of an import.
 *
 * Here there is only who commands whom and the record of what happened: every
 * attempt is left in `sync_runs`, with how many transactions were inserted and
 * updated and what error there was. That is what lets you see whether the
 * bank's call limit is getting close.
 *
 * The consent is in `consent.ts` and the real work in `import.ts`.
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

/** Past these hours, an «in progress» import is nothing of the sort. */
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
 * Opens the `sync_runs` row and nothing else.
 *
 * It is separate so that whoever launches the import in the background can
 * have the row **before** answering. Otherwise there is no way to draw the
 * state without guessing when it will be there: this used to be solved with a
 * 150 ms wait and crossed fingers, and if the insert took longer, the fragment
 * came out without the `hx-trigger` and the poll never started.
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

/** The real import, over a `sync_runs` row that already exists. */
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
      // The consent has expired: it has to be authorized again with SCA.
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
 * Closes the imports that were left hanging.
 *
 * The import runs in the background inside the server process. If the
 * container restarts halfway, the `sync_runs` row stays `running` forever
 * —there is nobody who can finish it— and the connections page is left
 * **polling every two seconds, forever and for everyone who looks at it**,
 * because the fragment only stops when the state is terminal.
 *
 * It also serves as a gate: while there is a live one, no other import of the
 * same connection is started.
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

/** If there is already a live one for this connection, no other is started. */
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
 * Closes this process's open imports right now.
 *
 * It is called by the server's orderly shutdown: if it stops while one is
 * going, better to leave it marked as failed than as `running`, where it
 * would keep the page polling until maintenance went by.
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
