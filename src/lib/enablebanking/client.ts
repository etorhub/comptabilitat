/**
 * Client de l'API d'Enable Banking.
 *
 * L'autenticacio es fa amb un JWT signat amb RS256 amb la clau privada de
 * l'aplicacio registrada al panell d'Enable Banking; el `kid` de la capçalera
 * es l'identificador de l'aplicacio.
 *
 * **La clau privada no surt d'aqui.** Es llegeix un cop, no s'escriu mai a cap
 * registre i no entra en cap missatge d'error.
 *
 * Traduccio de `backend/app/integrations/enablebanking/client.py`.
 */

import { importPKCS8, SignJWT } from "jose";

import { config } from "../config.ts";
import {
  DateRangeError,
  EnableBankingError,
  MissingCredentialsError,
  SessionExpiredError,
} from "./errors.ts";

const JWT_TTL_SECONDS = 3600;
/** Marge per no fer servir un testimoni just abans que caduqui. */
const JWT_REFRESH_MARGIN = 120;

/**
 * Llegeix la clau privada.
 *
 * Tres maneres, en ordre: la variable amb el PEM, la variable en base64 (que
 * es la que fa servir el desplegament amb Portainer) i el fitxer del secret
 * muntat.
 *
 * NOTA DE SEGURETAT: `EB_PRIVATE_KEY_B64` posa una clau de signatura PSD2 en
 * una variable d'entorn, que qualsevol cosa que corri dins del contenidor pot
 * llegir. Es conserva perque el desplegament hi depen, pero el secret muntat
 * (`EB_PRIVATE_KEY_PATH`) es millor i es el que hauria de fer-se servir.
 */
async function readPrivateKey(): Promise<string> {
  if (config.ebPrivateKey) return config.ebPrivateKey;
  if (config.ebPrivateKeyB64) {
    return Buffer.from(config.ebPrivateKeyB64, "base64").toString("utf8");
  }

  const file = Bun.file(config.ebPrivateKeyPath);
  if (await file.exists()) return file.text();

  throw new MissingCredentialsError(
    `No s'ha trobat la clau privada d'Enable Banking a ${config.ebPrivateKeyPath}. ` +
      "Comprova EB_PRIVATE_KEY, EB_PRIVATE_KEY_B64 o el secret eb_private_key del stack.",
  );
}

/** Marca de temps UTC amb sufix Z, que es el que espera Enable Banking. */
function isoZ(date: Date): string {
  return `${date.toISOString().slice(0, 23)}Z`;
}

export interface ClientOptions {
  applicationId?: string;
  privateKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class EnableBankingClient {
  private readonly applicationId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private privateKeyPem: string | null;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(options: ClientOptions = {}) {
    this.applicationId = options.applicationId ?? config.ebApplicationId;
    this.baseUrl = (options.baseUrl ?? config.ebApiOrigin).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.privateKeyPem = options.privateKey ?? null;
  }

  private async jwt(): Promise<string> {
    const ara = Date.now() / 1000;
    if (this.token !== null && ara < this.tokenExpiresAt - JWT_REFRESH_MARGIN) {
      return this.token;
    }
    if (!this.applicationId) {
      throw new MissingCredentialsError("Falta EB_APPLICATION_ID");
    }

    this.privateKeyPem ??= await readPrivateKey();
    const key = await importPKCS8(this.privateKeyPem, "RS256");

    const emes = Math.floor(ara);
    this.token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: this.applicationId, typ: "JWT" })
      .setIssuer("enablebanking.com")
      .setAudience("api.enablebanking.com")
      .setIssuedAt(emes)
      .setExpirationTime(emes + JWT_TTL_SECONDS)
      .sign(key);

    this.tokenExpiresAt = emes + JWT_TTL_SECONDS;
    return this.token;
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    options: { params?: Record<string, string | null | undefined>; json?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, valor] of Object.entries(options.params ?? {})) {
      if (valor !== null && valor !== undefined && valor !== "") {
        url.searchParams.set(key, valor);
      }
    }

    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.jwt()}`,
          ...(options.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EnableBankingError(
        `No s'ha pogut contactar Enable Banking: ${error instanceof Error ? error.message : error}`,
      );
    }

    if (resposta.status >= 400) throw await aError(resposta);

    const text = await resposta.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // --- Punts de l'API ------------------------------------------------------

  /** Dades de l'aplicacio registrada. Serveix per comprovar les credencials. */
  getApplication() {
    return this.request("GET", "/application");
  }

  async listAspsps(country?: string) {
    const payload = await this.request<{ aspsps?: Record<string, unknown>[] }>(
      "GET",
      "/aspsps",
      {
        params: { country },
      },
    );
    return payload.aspsps ?? [];
  }

  /** Inicia l'autoritzacio i retorna la URL on ha d'anar la persona. */
  startAuthorization(options: {
    aspspName: string;
    aspspCountry: string;
    redirectUrl: string;
    state: string;
    psuType?: string;
    validDays?: number;
  }) {
    const days = options.validDays ?? config.ebConsentDays;
    const valid = new Date(Date.now() + days * 86_400_000);

    return this.request<{ url?: string; authorization_url?: string }>("POST", "/auth", {
      json: {
        access: { valid_until: isoZ(valid) },
        aspsp: { name: options.aspspName, country: options.aspspCountry },
        state: options.state,
        redirect_url: options.redirectUrl,
        psu_type: options.psuType ?? "personal",
      },
    });
  }

  /** Bescanvia el codi del retorn del banc per una sessio amb els comptes. */
  createSession(code: string) {
    return this.request<{
      session_id?: string;
      access?: { valid_until?: string };
      accounts?: Record<string, unknown>[];
      aspsp?: Record<string, unknown>;
    }>("POST", "/sessions", { json: { code } });
  }

  getSession(sessionId: string) {
    return this.request("GET", `/sessions/${sessionId}`);
  }

  deleteSession(sessionId: string) {
    return this.request("DELETE", `/sessions/${sessionId}`);
  }

  getAccountDetails(accountUid: string) {
    return this.request("GET", `/accounts/${accountUid}/details`);
  }

  async getBalances(accountUid: string) {
    const payload = await this.request<{ balances?: Record<string, unknown>[] }>(
      "GET",
      `/accounts/${accountUid}/balances`,
    );
    return payload.balances ?? [];
  }

  /**
   * Recorre els moviments seguint el `continuation_key` de cada pagina.
   */
  async *iterTransactions(
    accountUid: string,
    options: {
      dateFrom: string;
      dateTo?: string | null;
      transactionStatus?: string | null;
      maxPages?: number;
    },
    // El `boolean` de retorn diu si s'ha arribat al limit de pagines, es a
    // dir, si el que s'ha llegit **no** es tot el que hi ha. Qui ho crida ho
    // ha de mirar: hi ha decisions —esborrar pendents que el banc ja no
    // reporta— que amb una llista incompleta esborrarien coses vives.
  ): AsyncGenerator<Record<string, unknown>, boolean> {
    const maxPages = options.maxPages ?? 200;
    let continuationKey: string | null = null;

    for (let page = 0; page < maxPages; page += 1) {
      const payload: {
        transactions?: Record<string, unknown>[];
        continuation_key?: string;
      } = await this.request("GET", `/accounts/${accountUid}/transactions`, {
        params: {
          date_from: options.dateFrom,
          date_to: options.dateTo,
          transaction_status: options.transactionStatus,
          continuation_key: continuationKey,
        },
      });

      for (const transaction of payload.transactions ?? []) yield transaction;

      continuationKey = payload.continuation_key ?? null;
      if (continuationKey === null) return false;
    }

    console.warn(
      `[enablebanking] compte ${accountUid}: s'ha arribat al limit de ${maxPages} pagines; ` +
        "la llista que se'n treu no es completa",
    );
    return true;
  }
}

/**
 * Converteix una resposta d'error en l'error del domini que toca.
 *
 * Els missatges dels bancs varien molt, aixi que es mira per paraules que hi
 * surten sempre, com feia el Python.
 */
async function aError(resposta: Response): Promise<EnableBankingError> {
  let payload: Record<string, unknown>;
  const text = await resposta.text();
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { message: text };
  }

  const message = String(payload.message ?? payload.error ?? text ?? "");
  const code = payload.code ?? payload.error ?? null;
  const search = `${code ?? ""} ${message}`.toUpperCase();

  const options = {
    statusCode: resposta.status,
    code: code === null ? null : String(code),
    payload,
  };

  if (search.includes("EXPIRED_SESSION") || search.includes("SESSION_EXPIRED")) {
    return new SessionExpiredError(message, options);
  }

  // Els bancs limiten quant enrere es pot consultar; el missatge varia molt.
  if (
    (resposta.status === 400 || resposta.status === 422) &&
    ["DATE", "PERIOD", "RANGE", "FROM"].some((paraula) => search.includes(paraula))
  ) {
    return new DateRangeError(message, options);
  }

  return new EnableBankingError(message, options);
}
