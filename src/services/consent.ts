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
import { creaAvis } from "./alerts.ts";

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
