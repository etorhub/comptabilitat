/**
 * The server.
 *
 * Middleware order matters: the session before the CSRF check (which needs the
 * token digest in order to validate), and both before any route.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";

import { ErrorPage, NotFoundPage } from "./components/shell.ts";
import { config, validateConfig } from "./lib/config.ts";
import { describeError, toastOnly } from "./lib/http.ts";
import { csrfMiddleware } from "./middleware/csrf.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { registerRoutes } from "./routes/index.ts";

validateConfig();

// Migrations run before any request is accepted, as the Python entrypoint did
// with Alembic. See `db/migrate.ts` for the first-boot case against a database
// that already exists.
//
// Careful: this import-time migration is also why `bun test` races on a fresh
// database when several test files import `app`. Use `bun run test:bd`.
if (process.env.SKIP_MIGRATIONS !== "true") {
  const { applyMigrations } = await import("./db/migrate.ts");
  await applyMigrations();
}

const app = new Hono();

if (config.debug) {
  app.use("*", logger());
}

// Static files: htmx, ECharts, the stylesheet and the favicon. The
// application serves them itself, so no web server is needed in front: with
// the stack change, the nginx that served the React interface is gone.
//
// A one-year `immutable`: the browser does not ask again. Templates append
// `?v=<digest>` (see `lib/estatics.ts`) so a deployment does not leave stale
// bytes in the cache.
const cacheEstatic = (_path: string, c: Context) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
};
app.use("/app.css", serveStatic({ path: "./public/app.css", onFound: cacheEstatic }));
app.use("/htmx.min.js", serveStatic({ path: "./public/htmx.min.js", onFound: cacheEstatic }));
app.use(
  "/echarts.min.js",
  serveStatic({ path: "./public/echarts.min.js", onFound: cacheEstatic }),
);
app.use("/grafics.js", serveStatic({ path: "./public/grafics.js", onFound: cacheEstatic }));
app.use("/favicon.svg", serveStatic({ path: "./public/favicon.svg", onFound: cacheEstatic }));

app.get("/salut", (c) => c.json({ status: "ok", environment: config.environment }));

app.use("*", sessionMiddleware);
app.use("*", csrfMiddleware);

registerRoutes(app);

/**
 * 404. On a navigation, the whole page; on an htmx request, a notice. The same
 * whether the resource does not exist or you have no access to it.
 */
app.notFound((c) => {
  if (c.req.header("HX-Request") === "true") {
    return toastOnly(c, "No s'ha trobat", 404);
  }
  c.status(404);
  return c.html(NotFoundPage());
});

/**
 * Any error that reaches this far. The detail of what broke goes to the log,
 * not to the screen: it could carry data from the bank.
 */
app.onError((err, c) => {
  const { status, message, detail } = describeError(err);
  if (c.req.header("HX-Request") === "true") {
    return toastOnly(c, message, status, "error", detail);
  }
  c.status(status as 400);
  return c.html(ErrorPage(message));
});

/**
 * Graceful shutdown.
 *
 * The scheduler already had one; the server did not, and it showed: the bank
 * import runs in the background inside this process, and a
 * `docker compose stop` kills it midway. The `sync_runs` row then stays
 * `running` for ever, and the connections page's fragment only stops when the
 * state is terminal: it keeps polling every two seconds, for everyone looking
 * at it.
 *
 * Here the pool is closed and any open imports are marked. Whatever escapes —
 * a sudden death, an OOM — is picked up by the maintenance job with
 * `closeStuckImports()`.
 */
function aturaEndreçadament(senyal: string): void {
  console.info(`[servidor] ${senyal}: aturant-se…`);
  void (async () => {
    try {
      const { closeOpenImports } = await import("./services/sync.ts");
      await closeOpenImports();
    } catch (error) {
      console.error("[servidor] no s'han pogut tancar les importacions:", error);
    } finally {
      const { closeDb } = await import("./db/client.ts");
      await closeDb().catch(() => undefined);
      process.exit(0);
    }
  })();
}

process.on("SIGTERM", () => aturaEndreçadament("SIGTERM"));
process.on("SIGINT", () => aturaEndreçadament("SIGINT"));

export default {
  port: config.port,
  fetch: app.fetch,
  // The first import of 24 months of history takes a while; nginx already
  // waits 300 s and the server must not cut it short.
  idleTimeout: 120,
};

export { app };
