/**
 * Qui ets: resol la sessio de la galeta i la deixa al context.
 *
 * Aquest middleware no fa fora ningu; nomes omple el context. Qui exigeix
 * autenticacio es `requireUser`.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import type { User } from "../db/schema/index.ts";
import { resolveSession } from "../lib/auth.ts";
import { config } from "../lib/config.ts";
import { csrfTokenFor } from "../lib/csrf.ts";
import { redirect } from "../lib/http.ts";

export interface SessionVars {
  user: User | null;
  sessionTokenHash: string | null;
  csrfToken: string | null;
}

declare module "hono" {
  interface ContextVariableMap extends SessionVars {}
}

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("user", null);
  c.set("sessionTokenHash", null);
  c.set("csrfToken", null);

  const token = getCookie(c, config.sessionCookieName);
  if (token) {
    const resolved = await resolveSession(token);
    if (resolved) {
      c.set("user", resolved.user);
      c.set("sessionTokenHash", resolved.tokenHash);
      c.set("csrfToken", await csrfTokenFor(resolved.tokenHash));
    }
  }

  await next();
};

/** L'usuari de la peticio, o peta. Fes-la servir despres de `requireUser`. */
export function currentUser(c: Context): User {
  const user = c.get("user");
  if (user === null) {
    throw new Error("currentUser() sense requireUser() al davant");
  }
  return user;
}

/**
 * Exigeix sessio. Si no n'hi ha, porta a l'entrada conservant on volia anar,
 * de manera que despres d'entrar hi torni.
 */
export const requireUser: MiddlewareHandler = async (c, next) => {
  if (c.get("user") === null) {
    const desti = new URL(c.req.url).pathname + new URL(c.req.url).search;
    const destiSegur = desti.startsWith("/") && !desti.startsWith("//") ? desti : "/";
    return redirect(c, `/entrada?desti=${encodeURIComponent(destiSegur)}`);
  }
  await next();
};

/** Exigeix ser administrador de la instal·lacio. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  if (!user.isAdmin) {
    // Igual que amb els espais: qui no ho es, no ha de saber que hi ha aqui.
    return c.notFound();
  }
  await next();
};
