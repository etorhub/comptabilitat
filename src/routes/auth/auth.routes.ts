/**
 * Entrada, sortida i canvi de contrasenya.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { PasswordForm } from "./auth.fragment.tsx";
import { LoginPage, PasswordPage } from "./auth.page.tsx";
import { loginSchema, passwordChangeSchema } from "./auth.schema.ts";
import { Layout } from "../../components/layout.tsx";
import { zodErrors } from "../../components/form.tsx";
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

/** Adreça de la primera pagina util: el primer espai on l'usuari tingui acces. */
async function primeraPagina(userId: number): Promise<string> {
  const espais = await myWorkspaces(userId);
  const primer = espais[0];
  return primer ? `/e/${primer.code}` : "/sense-espais";
}

// --- Entrada ---------------------------------------------------------------

authRoutes.get("/entrada", async (c) => {
  const user = c.get("user");
  if (user !== null) {
    return c.redirect(await primeraPagina(user.id), 303);
  }

  // Llavor d'un sol us perque el formulari pugui dur testimoni CSRF sense
  // que encara hi hagi sessio.
  let llavor = getCookie(c, CSRF_SEED_COOKIE);
  if (llavor === undefined) {
    llavor = newCsrfSeed();
    setCookie(c, CSRF_SEED_COOKIE, llavor, { ...cookieBase, maxAge: 3600 });
  }

  const desti = c.req.query("desti");
  return page(
    c,
    LoginPage({
      csrfToken: await csrfTokenFor(llavor),
      desti: desti && desti.startsWith("/") && !desti.startsWith("//") ? desti : "/",
    }),
  );
});

authRoutes.post("/entrada", async (c) => {
  const llavor = getCookie(c, CSRF_SEED_COOKIE) ?? newCsrfSeed();
  const csrfToken = await csrfTokenFor(llavor);

  const cos = await c.req.parseBody();
  const parsed = loginSchema.safeParse(cos);

  if (!parsed.success) {
    return fragment(
      c,
      LoginPage({
        csrfToken,
        errors: zodErrors(parsed.error),
        email: typeof cos.email === "string" ? cos.email : "",
        desti: typeof cos.desti === "string" ? cos.desti : "/",
      }),
      422,
    );
  }

  const { email, password, desti } = parsed.data;
  const ip =
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    c.req.header("X-Real-IP") ??
    "desconeguda";

  // Limit d'intents. L'aplicacio anterior no en tenia cap.
  if (loginBlocked(email, ip)) {
    return fragment(
      c,
      LoginPage({
        csrfToken,
        email,
        desti,
        errors: { _: ["Massa intents. Espera un quart d'hora i torna-ho a provar."] },
      }),
      429,
    );
  }

  const trobat = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const usuari = trobat[0];

  // Es comprova sempre una contrasenya, existeixi l'usuari o no: si no, el
  // temps de resposta diria quins correus estan donats d'alta.
  const correcta = usuari
    ? await verifyPassword(password, usuari.passwordHash)
    : (await burnPasswordTime(password), false);

  if (!usuari || !correcta || !usuari.isActive) {
    recordFailedLogin(email, ip);
    // El mateix missatge en els tres casos, per no dir quin dels tres es.
    return fragment(
      c,
      LoginPage({
        csrfToken,
        email,
        desti,
        errors: { _: ["El correu o la contrasenya no son correctes"] },
      }),
      401,
    );
  }

  clearFailedLogins(email, ip);

  const { token, expiresAt } = await createSession(usuari.id, c.req.header("User-Agent") ?? "");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, usuari.id));

  setCookie(c, config.sessionCookieName, token, {
    ...cookieBase,
    expires: expiresAt,
    maxAge: config.sessionMaxAgeDays * 86_400,
  });
  deleteCookie(c, CSRF_SEED_COOKIE, { path: "/" });

  return c.redirect(desti !== "/" ? desti : await primeraPagina(usuari.id), 303);
});

// --- Sortida ---------------------------------------------------------------

authRoutes.post("/sortida", async (c) => {
  const token = getCookie(c, config.sessionCookieName);
  if (token) await destroySession(token);
  deleteCookie(c, config.sessionCookieName, { path: "/" });
  return redirect(c, "/entrada");
});

// --- Contrasenya -----------------------------------------------------------

authRoutes.get("/contrasenya", requireUser, async (c) => {
  const user = currentUser(c);
  return page(
    c,
    Layout({
      titol: "Contrasenya",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      espais: await myWorkspaces(user.id),
      children: PasswordPage({ children: PasswordForm({}) }),
    }),
  );
});

authRoutes.post("/contrasenya", requireUser, async (c) => {
  const user = currentUser(c);
  const cos = await c.req.parseBody();
  const parsed = passwordChangeSchema.safeParse(cos);

  if (!parsed.success) {
    return fragment(c, PasswordForm({ errors: zodErrors(parsed.error) }), 422);
  }

  const fresc = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const usuari = fresc[0];
  if (!usuari || !(await verifyPassword(parsed.data.current_password, usuari.passwordHash))) {
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
   * Tanca la resta de sessions i conserva la d'aqui, que es el que diu
   * `docs/operacio.md`. Fer-les caure totes tambe invalidaria el testimoni
   * CSRF que ja hi ha dibuixat en aquesta pagina —en deriva—, i la peticio
   * següent d'HTMX fallaria sense que s'entengues per que.
   */
  const tokenHash = c.get("sessionTokenHash");
  if (tokenHash !== null) {
    await destroyOtherSessions(user.id, tokenHash);
  }

  return fragment(c, PasswordForm({ fet: true }));
});
