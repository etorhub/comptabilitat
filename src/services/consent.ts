/**
 * El cicle de vida del consentiment del banc.
 *
 * Sota PSD2, per llegir un compte cal que la persona hi doni permis al banc, i
 * aquell permis **caduca cada 90 dies**: no hi ha manera d'evitar-ho, l'unic
 * que es pot fer es avisar a temps i tornar a demanar-lo.
 *
 * Aixo no te res a veure amb importar moviments —vegeu `import.ts`—, i es
 * l'unica part que es crida des d'una ruta i no des d'una feina programada.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, bankConnections, type BankConnection } from "../db/schema/index.ts";
import { config, ebRedirectUrl } from "../lib/config.ts";
import { EnableBankingClient } from "../lib/enablebanking/client.ts";
import { parseAccount } from "../lib/enablebanking/parsing.ts";
import { daysBetween, todayLocal } from "../lib/time.ts";
import { createAlert } from "./alerts.ts";

// --- Autoritzacio ------------------------------------------------------------

function randomState(): string {
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
    const [creada] = await db
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
    connection = creada;
  }

  if (!connection) throw new Error("No s'ha pogut crear la connexio");

  const client = new EnableBankingClient();
  const resposta = await client.startAuthorization({
    aspspName,
    aspspCountry,
    redirectUrl: ebRedirectUrl,
    state: state,
    psuType,
  });

  const url = resposta.url ?? resposta.authorization_url;
  if (!url) throw new Error("El banc no ha tornat cap adreça d'autoritzacio");

  return { authorizationUrl: url, connectionId: connection.id };
}

/**
 * Tanca l'autoritzacio amb el codi que torna el banc.
 *
 * Els comptes s'insereixen o s'actualitzen per `eb_account_uid`, de manera que
 * renovar el consentiment **conserva l'espai assignat i l'historic**.
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

  const [actualitzada] = await db
    .update(bankConnections)
    .set({
      ebSessionId: session.session_id ?? null,
      // L'estat es d'un sol us.
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
      // No es toca `ledgerId`: l'espai assignat es conserva.
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

  return actualitzada ?? connection;
}

/**
 * Avisa dels consentiments a punt de caducar i marca els que ja ho han fet.
 *
 * Sota PSD2 caduquen cada 90 dies i no hi ha manera d'evitar-ho: l'unic que es
 * pot fer es avisar a temps, 7, 3 i 1 dia abans.
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

    const creat = await createAlert({
      type: "consent_expiring",
      ledgerId: null,
      dedupKey: `consent-expiring:${connection.id}:${days}`,
      title: `${connection.aspspName}: el consentiment caduca en ${days} ${days === 1 ? "dia" : "dies"}`,
      body: "Cal tornar a autoritzar el banc des de Connexions abans que caduqui, o la importacio s'aturara.",
      severity: days <= 1 ? "critical" : "warning",
      payload: { connection_id: connection.id, days_left: days },
    });
    if (creat) created += 1;
  }

  return created;
}
