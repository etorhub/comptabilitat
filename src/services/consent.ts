/**
 * The life cycle of the bank's consent.
 *
 * Under PSD2, reading an account requires the person to give the bank
 * permission, and that permission **expires every 90 days**: there is no way
 * around it, all that can be done is to warn in time and ask for it again.
 *
 * This has nothing to do with importing transactions —see `import.ts`—, and
 * it is the only part called from a route and not from a scheduled job.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, bankConnections, type BankConnection } from "../db/schema/index.ts";
import { config, ebRedirectUrl } from "../lib/config.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { parseAccount } from "../lib/enablebanking/parsing.ts";
import { daysBetween, todayLocal } from "../lib/time.ts";
import { createAlert } from "./alerts.ts";

// --- Authorization -----------------------------------------------------------

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Starts the authorization and returns the bank's URL.
 *
 * If a connection is passed, this is a consent renewal: the connection is kept
 * (and therefore its accounts, the workspace they are assigned to and all the
 * history) and only its session is renewed.
 */
export async function beginAuthorization(options: {
  aspspName?: string;
  aspspCountry?: string;
  psuType?: string;
  connectionId?: number | null;
  userId: number;
}): Promise<{ authorizationUrl: string; connectionId: number }> {
  const aspspName = options.aspspName || config.ebDefaultAspspName;
  const aspspCountry = options.aspspCountry || config.ebDefaultAspspCountry;
  const psuType = options.psuType || "personal";
  const state = randomState();

  let connection: BankConnection | undefined;

  if (options.connectionId != null) {
    [connection] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, options.connectionId))
      .limit(1);
  }

  if (connection) {
    await db
      .update(bankConnections)
      .set({ ebAuthState: state })
      .where(eq(bankConnections.id, connection.id));
  } else {
    const [created] = await db
      .insert(bankConnections)
      .values({
        name: aspspName,
        aspspName,
        aspspCountry,
        psuType,
        ebSessionId: null,
        ebAuthState: state,
        status: "pending",
        validUntil: null,
        lastSyncAt: null,
        lastError: "",
        createdById: options.userId,
      })
      .returning();
    connection = created;
  }

  if (!connection) throw new Error("No s'ha pogut crear la connexio");

  const client = new EnableBankingClient();
  const response = await client.startAuthorization({
    aspspName,
    aspspCountry,
    redirectUrl: ebRedirectUrl,
    state: state,
    psuType,
  });

  const url = response.url ?? response.authorization_url;
  if (!url) throw new Error("El banc no ha tornat cap adreça d'autoritzacio");

  return { authorizationUrl: url, connectionId: connection.id };
}

/**
 * Closes the authorization with the code the bank returns.
 *
 * The accounts are inserted or updated by `eb_account_uid`, so renewing the
 * consent **keeps the assigned workspace and the history**.
 */
export async function finishAuthorization(
  code: string,
  state: string,
): Promise<BankConnection> {
  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.ebAuthState, state))
    .limit(1);

  if (!connection) throw new Error("Estat d'autoritzacio desconegut");

  const client = new EnableBankingClient();
  const session = await client.createSession(code);

  const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : null;

  const [updated] = await db
    .update(bankConnections)
    .set({
      ebSessionId: session.session_id ?? null,
      // The state is single-use.
      ebAuthState: null,
      status: "active",
      validUntil,
      lastError: "",
    })
    .where(eq(bankConnections.id, connection.id))
    .returning();

  for (const raw of session.accounts ?? []) {
    const data = parseAccount(raw);
    if (!data.ebAccountUid) continue;

    const [ja] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.ebAccountUid, data.ebAccountUid))
      .limit(1);

    if (ja) {
      // `ledgerId` is not touched: the assigned workspace is kept.
      await db
        .update(accounts)
        .set({
          connectionId: connection.id,
          name: data.name || ja.name,
          product: data.product,
          iban: data.iban || ja.iban,
          currency: data.currency,
          cashAccountType: data.cashAccountType,
          usage: data.usage,
          isActive: true,
          raw: data.raw,
        })
        .where(eq(accounts.id, ja.id));
    } else {
      await db.insert(accounts).values({
        connectionId: connection.id,
        ledgerId: null,
        ebAccountUid: data.ebAccountUid,
        name: data.name,
        product: data.product,
        iban: data.iban,
        currency: data.currency,
        cashAccountType: data.cashAccountType,
        usage: data.usage,
        isActive: true,
        historyStartDate: null,
        lastBookedDate: null,
        raw: data.raw,
      });
    }
  }

  return updated ?? connection;
}

/**
 * Warns about consents about to expire and marks the ones that already have.
 *
 * Under PSD2 they expire every 90 days and there is no way around it: all
 * that can be done is to warn in time, 7, 3 and 1 day before.
 */
export async function checkConsents(): Promise<number> {
  const today = todayLocal();
  let created = 0;

  const connections = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.status, "active"));

  for (const connection of connections) {
    if (connection.validUntil === null) continue;

    const days = daysBetween(today, connection.validUntil.toISOString().slice(0, 10));

    if (days < 0) {
      await db
        .update(bankConnections)
        .set({ status: "expired" })
        .where(eq(bankConnections.id, connection.id));
      continue;
    }

    if (![7, 3, 1].includes(days)) continue;

    const createdOne = await createAlert({
      type: "consent_expiring",
      ledgerId: null,
      dedupKey: `consent-expiring:${connection.id}:${days}`,
      title: `${connection.aspspName}: el consentiment caduca en ${days} ${days === 1 ? "dia" : "dies"}`,
      body: "Cal tornar a autoritzar el banc des de Connexions abans que caduqui, o la importacio s'aturara.",
      severity: days <= 1 ? "critical" : "warning",
      payload: { connection_id: connection.id, days_left: days },
    });
    if (createdOne) created += 1;
  }

  return created;
}
