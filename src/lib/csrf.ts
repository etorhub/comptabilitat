/**
 * CSRF.
 *
 * The Python application **had no defence at all**: the cookie was
 * `SameSite=Lax` and that was it. That stops the easy case but not a top-level
 * `POST` from another page (`SameSite=Lax` lets top-level GET navigations
 * through, and a form submitted from another tab travels with the cookie when
 * the browser counts it as a navigation). With htmx, on top of that,
 * everything is a background request.
 *
 * The token is `HMAC-SHA256(SECRET_KEY, session_token_digest)`:
 *
 *   - no table and no server state are needed;
 *   - it is tied to the session, so it rotates when the session does and dies
 *     with it;
 *   - whoever lacks the cookie cannot compute it, and whoever has it is
 *     already the user.
 *
 * It is published **once**, as the `<body>`'s `hx-headers`, and every htmx
 * request inherits it. Never one per form.
 */

import type { Context } from "hono";

import { config } from "./config.ts";

const encoder = new TextEncoder();

let hmacKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (hmacKey !== null) return hmacKey;
  hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return hmacKey;
}

/** A session's CSRF token. Deterministic: same session, same token. */
export async function csrfTokenFor(sessionTokenHash: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getKey(),
    encoder.encode(sessionTokenHash),
  );
  return Buffer.from(signature).toString("base64url");
}

/** Constant-time comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function csrfTokenValid(
  sessionTokenHash: string,
  presented: string | undefined | null,
): Promise<boolean> {
  if (!presented) return false;
  return timingSafeEqual(await csrfTokenFor(sessionTokenHash), presented);
}

/**
 * Origin check, as a second barrier.
 *
 * `Sec-Fetch-Site` is the good signal, and the browser sets it, not the page.
 * When it is absent (older browsers), `Origin` is checked against
 * `PUBLIC_BASE_URL`. When neither signal is present nothing is rejected: there
 * are legitimate clients that send neither, and the token already does the job.
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

/** The hidden field's name, for the forms that do not go through htmx. */
export const CSRF_FIELD = "_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

/**
 * A seed for the forms that come before signing in.
 *
 * The login form has to be protected too — otherwise somebody could sign you
 * in as them without your noticing — but there is no session yet to derive the
 * token from. So a cookie is set with a random value and the token is the HMAC
 * of that value: whoever has not loaded the page cannot compute it.
 *
 * It is short-lived and is replaced by the session one as soon as you sign in.
 */
export const CSRF_SEED_COOKIE = "comptabilitat_csrf";

export function newCsrfSeed(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
