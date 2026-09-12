/**
 * Who you are: resolves the cookie's session and leaves it on the context.
 *
 * This middleware turns nobody away; it only fills the context. `requireUser`
 * is what demands authentication.
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

/** The request's user, or it throws. Use it after `requireUser`. */
export function currentUser(c: Context): User {
  const user = c.get("user");
  if (user === null) {
    throw new Error("currentUser() sense requireUser() al davant");
  }
  return user;
}

/**
 * Demands a session. Without one, it sends you to the login page keeping where
 * you were headed, so that signing in takes you back there.
 */
export const requireUser: MiddlewareHandler = async (c, next) => {
  if (c.get("user") === null) {
    const target = new URL(c.req.url).pathname + new URL(c.req.url).search;
    const safeTarget = target.startsWith("/") && !target.startsWith("//") ? target : "/";
    return redirect(c, `/entrada?desti=${encodeURIComponent(safeTarget)}`);
  }
  await next();
};

/** Demands being an administrator of the installation. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  if (!user.isAdmin) {
    // Same as with workspaces: whoever is not one should not learn what is here.
    return c.notFound();
  }
  await next();
};
