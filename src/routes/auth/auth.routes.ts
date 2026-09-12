/**
 * Sign in, sign out and password change.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { PasswordForm } from "./auth.fragment.ts";
import { LoginPage, PasswordPage } from "./auth.page.ts";
import { loginSchema, passwordChangeSchema } from "./auth.schema.ts";
import { Layout } from "../../components/layout.ts";
import { zodErrors } from "../../components/form.ts";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema/index.ts";
import {
  burnPasswordTime,
  clearFailedLogins,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  loginBlocked,
  recordFailedLogin,
  verifyPassword,
} from "../../lib/auth.ts";
import { config } from "../../lib/config.ts";
import { CSRF_SEED_COOKIE, csrfTokenFor, newCsrfSeed } from "../../lib/csrf.ts";
import { fragment, page, redirect } from "../../lib/http.ts";
import { currentUser, requireUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";

export const authRoutes = new Hono();

const cookieBase = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "Lax",
  path: "/",
} as const;

/** URL of the first useful page: the first workspace the user can access. */
async function firstPage(userId: number): Promise<string> {
  const workspaces = await myWorkspaces(userId);
  const first = workspaces[0];
  return first ? `/e/${first.code}` : "/sense-espais";
}

// --- Sign in ---------------------------------------------------------------

authRoutes.get("/entrada", async (c) => {
  const user = c.get("user");
  if (user !== null) {
    return c.redirect(await firstPage(user.id), 303);
  }

  // Single-use seed so that the form can carry a CSRF token while there is
  // still no session.
  let seed = getCookie(c, CSRF_SEED_COOKIE);
  if (seed === undefined) {
    seed = newCsrfSeed();
    setCookie(c, CSRF_SEED_COOKIE, seed, { ...cookieBase, maxAge: 3600 });
  }

  const target = c.req.query("desti");
  return page(
    c,
    LoginPage({
      csrfToken: await csrfTokenFor(seed),
      target: target && target.startsWith("/") && !target.startsWith("//") ? target : "/",
    }),
  );
});

authRoutes.post("/entrada", async (c) => {
  const seed = getCookie(c, CSRF_SEED_COOKIE) ?? newCsrfSeed();
  const csrfToken = await csrfTokenFor(seed);

  const body = await c.req.parseBody();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return fragment(
      c,
      LoginPage({
        csrfToken,
        errors: zodErrors(parsed.error),
        email: typeof body.email === "string" ? body.email : "",
        target: typeof body.desti === "string" ? body.desti : "/",
      }),
      422,
    );
  }

  const { email, password, target } = parsed.data;
  const ip =
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    c.req.header("X-Real-IP") ??
    "desconeguda";

  // Attempt limit. The previous application had none.
  if (loginBlocked(email, ip)) {
    return fragment(
      c,
      LoginPage({
        csrfToken,
        email,
        target,
        errors: { _: ["Massa intents. Espera un quart d'hora i torna-ho a provar."] },
      }),
      429,
    );
  }

  const foundOne = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = foundOne[0];

  // A password is always checked, whether the user exists or not: otherwise
  // the response time would tell which emails are registered.
  const correct = user
    ? await verifyPassword(password, user.passwordHash)
    : (await burnPasswordTime(password), false);

  if (!user || !correct || !user.isActive) {
    recordFailedLogin(email, ip);
    // The same message in all three cases, so as not to say which of the three it is.
    return fragment(
      c,
      LoginPage({
        csrfToken,
        email,
        target,
        errors: { _: ["El correu o la contrasenya no son correctes"] },
      }),
      401,
    );
  }

  clearFailedLogins(email, ip);

  const { token, expiresAt } = await createSession(user.id, c.req.header("User-Agent") ?? "");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  setCookie(c, config.sessionCookieName, token, {
    ...cookieBase,
    expires: expiresAt,
    maxAge: config.sessionMaxAgeDays * 86_400,
  });
  deleteCookie(c, CSRF_SEED_COOKIE, { path: "/" });

  return c.redirect(target !== "/" ? target : await firstPage(user.id), 303);
});

// --- Sign out --------------------------------------------------------------

authRoutes.post("/sortida", async (c) => {
  const token = getCookie(c, config.sessionCookieName);
  if (token) await destroySession(token);
  deleteCookie(c, config.sessionCookieName, { path: "/" });
  return redirect(c, "/entrada");
});

// --- Password --------------------------------------------------------------

authRoutes.get("/contrasenya", requireUser, async (c) => {
  const user = currentUser(c);
  return page(
    c,
    Layout({
      title: "Contrasenya",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      path: c.req.path,
      workspaces: await myWorkspaces(user.id),
      children: PasswordPage({ children: PasswordForm({}) }),
    }),
  );
});

authRoutes.post("/contrasenya", requireUser, async (c) => {
  const user = currentUser(c);
  const body = await c.req.parseBody();
  const parsed = passwordChangeSchema.safeParse(body);

  if (!parsed.success) {
    return fragment(c, PasswordForm({ errors: zodErrors(parsed.error) }), 422);
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const stored = rows[0];
  if (!stored || !(await verifyPassword(parsed.data.current_password, stored.passwordHash))) {
    return fragment(
      c,
      PasswordForm({ errors: { current_password: ["La contrasenya actual no es correcta"] } }),
      422,
    );
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.new_password) })
    .where(eq(users.id, user.id));

  /**
   * Closes the other sessions and keeps this one, which is what
   * `docs/operacio.md` says. Dropping them all would also invalidate the CSRF
   * token already drawn on this page —it derives from it—, and the next HTMX
   * request would fail for no visible reason.
   */
  const tokenHash = c.get("sessionTokenHash");
  if (tokenHash !== null) {
    await destroyOtherSessions(user.id, tokenHash);
  }

  return fragment(c, PasswordForm({ done: true }));
});
