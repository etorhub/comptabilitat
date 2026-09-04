/**
 * Servidor.
 *
 * L'ordre dels middlewares importa: la sessio abans que el CSRF (que
 * necessita el resum del testimoni per validar), i tots dos abans que cap
 * ruta.
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";

import { ErrorPage, NotFoundPage } from "./components/shell.tsx";
import { config, validateConfig } from "./lib/config.ts";
import { describeError, toastOnly } from "./lib/http.ts";
import { csrfMiddleware } from "./middleware/csrf.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { registerRoutes } from "./routes/index.ts";

validateConfig();

// Les migracions s'apliquen abans d'acceptar cap peticio, com feia
// l'entrypoint de Python amb Alembic. Vegeu `db/migrate.ts` per al cas del
// primer arrencada sobre una base de dades que ja existeix.
if (process.env.SKIP_MIGRATIONS !== "true") {
  const { aplicaMigracions } = await import("./db/migrate.ts");
  await aplicaMigracions();
}

const app = new Hono();

if (config.debug) {
  app.use("*", logger());
}

// Fitxers estatics: HTMX, ECharts, el full d'estil i el favicon. Els serveix
// l'aplicacio mateixa, de manera que no cal cap servidor web al davant: amb el
// canvi de pila, l'nginx que servia la interficie de React ja no hi es.
app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/htmx.min.js", serveStatic({ path: "./public/htmx.min.js" }));
app.use("/echarts.min.js", serveStatic({ path: "./public/echarts.min.js" }));
app.use("/grafics.js", serveStatic({ path: "./public/grafics.js" }));
app.use("/favicon.svg", serveStatic({ path: "./public/favicon.svg" }));

app.get("/salut", (c) => c.json({ status: "ok", environment: config.environment }));

app.use("*", sessionMiddleware);
app.use("*", csrfMiddleware);

registerRoutes(app);

/**
 * 404. En una navegacio, la pagina sencera; en una peticio d'HTMX, un avis.
 * Es el mateix tant si el recurs no existeix com si no hi tens acces.
 */
app.notFound((c) => {
  if (c.req.header("HX-Request") === "true") {
    return toastOnly(c, "No s'ha trobat", 404);
  }
  c.status(404);
  return c.html(NotFoundPage());
});

/**
 * Qualsevol error que arribi fins aqui. El detall del que ha petat va al
 * registre, no a la pantalla: podria dur-hi dades del banc.
 */
app.onError((err, c) => {
  const { status, missatge, detall } = describeError(err);
  if (c.req.header("HX-Request") === "true") {
    return toastOnly(c, missatge, status, "error", detall);
  }
  c.status(status as 400);
  return c.html(ErrorPage(missatge));
});

export default {
  port: config.port,
  fetch: app.fetch,
  // La primera importacio d'un historic de 24 mesos triga; nginx ja espera
  // 300 s i el servidor no ha de tallar abans.
  idleTimeout: 120,
};

export { app };
