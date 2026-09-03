/**
 * Comprovacio de CSRF a tota peticio que canvia alguna cosa.
 *
 * Els `GET` i els `HEAD` no s'hi miren perque no han de canviar res; si
 * alguna ruta `GET` canvia alguna cosa, la ruta esta malament.
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
 * Rutes exemptes.
 *
 * Nomes n'hi ha una: el retorn del banc despres de l'autenticacio forta. Qui
 * hi arriba ve del banc i no pot dur cap testimoni nostre; el que la protegeix
 * es l'`eb_auth_state` d'un sol us que va generar la connexio. A mes es un
 * `GET`, o sigui que ja no hi passaria.
 */
const EXEMPTES: readonly RegExp[] = [/^\/api\/auth\/callback$/];

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (METODES_SEGURS.has(c.req.method)) {
    return next();
  }

  const cami = new URL(c.req.url).pathname;
  if (EXEMPTES.some((patro) => patro.test(cami))) {
    return next();
  }

  if (!originAllowed(c)) {
    return toastOnly(c, "La peticio ve d'un lloc que no toca", 403);
  }

  /**
   * Amb sessio, la llavor es el resum del testimoni de sessio. Sense (el
   * formulari d'entrada), es la galeta d'un sol us que va posar el `GET`.
   */
  const llavor = c.get("sessionTokenHash") ?? getCookie(c, CSRF_SEED_COOKIE) ?? null;
  if (llavor === null) {
    return toastOnly(c, "La sessio s'ha tancat. Torna a carregar la pagina.", 403);
  }

  // La capçalera la posa `hx-headers` del `<body>`; el camp ocult, els
  // formularis que no passen per HTMX (l'entrada).
  let presentat = c.req.header(CSRF_HEADER);
  if (presentat === undefined) {
    const tipus = c.req.header("Content-Type") ?? "";
    if (
      tipus.includes("application/x-www-form-urlencoded") ||
      tipus.includes("multipart/form-data")
    ) {
      const cos = await c.req.parseBody();
      const camp = cos[CSRF_FIELD];
      if (typeof camp === "string") presentat = camp;
    }
  }

  if (!(await csrfTokenValid(llavor, presentat))) {
    return toastOnly(c, "El formulari ha caducat. Torna a carregar la pagina.", 403);
  }

  await next();
};
