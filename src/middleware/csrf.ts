/**
 * CSRF check on every request that changes something.
 *
 * `GET` and `HEAD` are not checked because they should not change anything; if
 * some `GET` route does, that route is wrong.
 */

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import {
  CSRF_FIELD,
  CSRF_HEADER,
  CSRF_SEED_COOKIE,
  csrfTokenValid,
  originAllowed,
} from "../lib/csrf.ts";
import { toastOnly } from "../lib/http.ts";

const METODES_SEGURS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Exempt routes.
 *
 * There is only one: the bank's callback after strong authentication. Whoever
 * arrives there comes from the bank and cannot carry a token of ours; what
 * protects it is the single-use `eb_auth_state` the connection generated. It
 * is also a `GET`, so it would not reach here anyway.
 */
const EXEMPTES: readonly RegExp[] = [/^\/api\/auth\/callback$/];

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (METODES_SEGURS.has(c.req.method)) {
    return next();
  }

  const path = new URL(c.req.url).pathname;
  if (EXEMPTES.some((patro) => patro.test(path))) {
    return next();
  }

  if (!originAllowed(c)) {
    return toastOnly(c, "La peticio ve d'un lloc que no toca", 403);
  }

  /**
   * With a session, the seed is the session token's digest. Without one (the
   * login form), it is the single-use cookie the `GET` set.
   */
  const seed = c.get("sessionTokenHash") ?? getCookie(c, CSRF_SEED_COOKIE) ?? null;
  if (seed === null) {
    return toastOnly(c, "La sessio s'ha tancat. Torna a carregar la pagina.", 403);
  }

  // The header comes from the `<body>`'s `hx-headers`; the hidden field comes
  // from the forms that do not go through htmx (the login form).
  let presented = c.req.header(CSRF_HEADER);
  if (presented === undefined) {
    const type = c.req.header("Content-Type") ?? "";
    if (
      type.includes("application/x-www-form-urlencoded") ||
      type.includes("multipart/form-data")
    ) {
      const body = await c.req.parseBody();
      const field = body[CSRF_FIELD];
      if (typeof field === "string") presented = field;
    }
  }

  if (!(await csrfTokenValid(seed, presented))) {
    return toastOnly(c, "El formulari ha caducat. Torna a carregar la pagina.", 403);
  }

  await next();
};
