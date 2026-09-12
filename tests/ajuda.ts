/**
 * What every test needs and each one used to rewrite.
 *
 * The `signIn()` here was copied into **seven** test files, with the same two
 * pairs of brackets and the same two regular expressions —ten copies of one,
 * six of the other— and small differences in variable names that meant
 * nothing. When something is copied seven times, the eighth person who needs
 * it writes yet another slightly different version.
 *
 * It is not a test file (`ajuda.ts`, not `ajuda.test.ts`): `bun test` only
 * picks up `*.test.ts`.
 *
 * **The tokens are read from the markup, not with a regular expression.** The
 * session's CSRF lives in the `<body>`'s `hx-headers` and the sign-in one in a
 * hidden field; `attributeOf()` takes them from there by looking at the real
 * attributes. A regular expression over HTML is right until somebody moves an
 * attribute or changes the quotes, and then it fails in a way nobody understands.
 */

import { attributeOf } from "../htmx-contract/index.ts";
import { app } from "../src/server.ts";

/** The password every test uses. */
export const PASSWORD = "provaprovaprova";

export interface Session {
  /** The session cookie, ready to put in `Cookie`. */
  cookie: string;
  /** The token for any request that is not a `GET`. */
  csrf: string;
}

/** The first cookie of a `set-cookie`, without its attributes. */
function firstCookie(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/**
 * Signs in and returns the session cookie and the CSRF token that goes with it.
 *
 * They are two requests because the application does it in two steps: the
 * sign-in form has no session yet and carries a `_csrf` derived from a
 * single-use seed cookie; the real token does not exist until the session does.
 */
export async function signIn(email: string, contrasenya = PASSWORD): Promise<Session> {
  const form = await app.request("/entrada");
  const seed = firstCookie(form);
  const field = (await attributeOf(await form.text(), 'input[name="_csrf"]', "value")) ?? "";

  const login = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seed },
    body: new URLSearchParams({ _csrf: field, email, password: contrasenya }).toString(),
  });
  const cookie = firstCookie(login);

  return { cookie, csrf: await csrfForSession(cookie) };
}

/**
 * The CSRF token any page of the session carries.
 *
 * It comes from the `<body>`'s `hx-headers`, which is where the layout
 * publishes it once so that every HTMX request inherits it.
 */
export async function csrfForSession(cookie: string): Promise<string> {
  const page = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const headers = await attributeOf(await page.text(), "body", "hx-headers");
  if (headers === null) return "";
  try {
    const llegit: unknown = JSON.parse(headers);
    if (typeof llegit !== "object" || llegit === null) return "";
    const value = (llegit as Record<string, unknown>)["X-CSRF-Token"];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** An authenticated request, with the token already set if needed. */
export async function requestAs(
  session: Session,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const metode = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Cookie", session.cookie);
  if (metode !== "GET" && metode !== "HEAD") headers.set("X-CSRF-Token", session.csrf);
  return app.request(url, { ...init, headers: headers });
}
