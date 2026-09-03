/**
 * CSRF.
 *
 * L'aplicacio de Python **no en tenia cap defensa**: la galeta era
 * `SameSite=Lax` i prou. Aixo atura el cas facil, pero no una peticio
 * `POST` de nivell superior des d'una altra pagina (`SameSite=Lax` deixa
 * passar les navegacions GET de nivell superior, i qualsevol formulari
 * enviat des d'una altra pestanya viatja amb la galeta si el navegador ho
 * considera una navegacio). Amb HTMX, a mes, tot son peticions de fons.
 *
 * El testimoni es `HMAC-SHA256(SECRET_KEY, resum_del_testimoni_de_sessio)`:
 *
 *   - no cal cap taula ni cap estat de servidor;
 *   - va lligat a la sessio, de manera que gira quan gira la sessio i mor
 *     amb ella;
 *   - qui no te la galeta no el pot calcular, i qui la te ja es l'usuari.
 *
 * Es publica **un sol cop**, com a `hx-headers` del `<body>`, i totes les
 * peticions d'HTMX l'hereten. Mai un per formulari.
 */

import type { Context } from "hono";

import { config } from "./config.ts";

const encoder = new TextEncoder();

let clauHmac: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (clauHmac !== null) return clauHmac;
  clauHmac = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return clauHmac;
}

/** Testimoni CSRF d'una sessio. Determinista: la mateixa sessio, el mateix. */
export async function csrfTokenFor(sessionTokenHash: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getKey(),
    encoder.encode(sessionTokenHash),
  );
  return Buffer.from(signature).toString("base64url");
}

/** Comparacio en temps constant. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function csrfTokenValid(
  sessionTokenHash: string,
  presentat: string | undefined | null,
): Promise<boolean> {
  if (!presentat) return false;
  return timingSafeEqual(await csrfTokenFor(sessionTokenHash), presentat);
}

/**
 * Comprovacio d'origen, com a segona barrera.
 *
 * `Sec-Fetch-Site` es el senyal bo i el posa el navegador, no la pagina.
 * Quan no hi es (navegadors vells), es mira `Origin` contra
 * `PUBLIC_BASE_URL`. Si no hi ha cap dels dos senyals, no es rebutja: hi ha
 * clients legitims que no els envien i el testimoni ja fa la feina.
 */
export function originAllowed(c: Context): boolean {
  const fetchSite = c.req.header("Sec-Fetch-Site");
  if (fetchSite !== undefined) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  const origin = c.req.header("Origin");
  if (origin === undefined) return true;

  try {
    return new URL(origin).origin === new URL(config.publicBaseUrl).origin;
  } catch {
    return false;
  }
}

/** Nom del camp ocult per als formularis que no passen per HTMX. */
export const CSRF_FIELD = "_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

/**
 * Llavor per als formularis d'abans d'entrar.
 *
 * El formulari d'entrada tambe s'ha de protegir —si no, algu et podria fer
 * entrar amb un compte seu sense que te n'adonessis— pero encara no hi ha
 * sessio de la qual derivar el testimoni. Per aixo es posa una galeta amb un
 * valor aleatori i el testimoni es l'HMAC d'aquest valor: qui no ha carregat
 * la pagina no el pot calcular.
 *
 * Dura poc i es substitueix per la de sessio tan bon punt s'entra.
 */
export const CSRF_SEED_COOKIE = "comptabilitat_csrf";

export function newCsrfSeed(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
