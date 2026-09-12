/**
 * Bank connections. Installation administrators only.
 *
 * DECISION ABOUT SYNCHRONIZATION. In the Python application, pressing
 * «Sincronitza» ran the whole import **inside the HTTP request**, with no
 * time limit at all (`routes/connections.py:127`). With the
 * `proxy_read_timeout 300s` of the nginx sitting in front, a first import of
 * 24 months of history is a 502 waiting to happen.
 *
 * Here the job starts in the background and the route answers straight away
 * with the `sync_runs` row in the «running» state. The fragment it returns
 * polls a status route and, when the job finishes, the new fragment no longer
 * carries a trigger: the poll stops by itself. If the job never finishes, the
 * attempt counter stops it. **It is one of the application's two polls** (the
 * other being the one for jobs in progress at `/feines`).
 *
 * There is no queue and no broker because neither is needed: this is a
 * single-machine installation and the bank only allows a few calls a day.
 */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { Layout } from "../../components/layout.ts";
import { db } from "../../db/client.ts";
import {
  accounts,
  bankConnections,
  ledgers,
  syncRuns,
  type SyncRun,
} from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import {
  AppError,
  NotFoundError,
  fragment,
  idFromRoute,
  page,
  redirect,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { daysBetween, todayLocal } from "../../lib/time.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { moveAccountToWorkspace, type TransactionSummary } from "../../services/accounts.ts";
import { lastBalance } from "../../services/balances.ts";
import { finishAuthorization, beginAuthorization } from "../../services/consent.ts";
import { alreadySyncing, openImport, runTheImport } from "../../services/sync.ts";
import { SyncState, AccountRow, List, type ConnectionView } from "./connections.fragment.ts";
import { ConnectionsPage } from "./connections.page.ts";
import { attemptFromQuery, ATTEMPT_PARAM } from "../../lib/sondeig.ts";
import {
  assignSchema,
  authorizeSchema,
  callbackSchema,
  syncSchema,
} from "./connections.schema.ts";

export const connectionsRoutes = new Hono();

/** The IBAN is only ever shown masked. */
function ibanEmmascarat(iban: string): string {
  if (iban.length <= 8) return iban ? "····" : "";
  return `${iban.slice(0, 4)}····${iban.slice(-4)}`;
}

async function listConnections(): Promise<ConnectionView[]> {
  const connections = await db
    .select()
    .from(bankConnections)
    .orderBy(desc(bankConnections.createdAt));

  const today = todayLocal();
  const result: ConnectionView[] = [];

  for (const connection of connections) {
    const accountList = await db
      .select()
      .from(accounts)
      .where(eq(accounts.connectionId, connection.id))
      .orderBy(accounts.name);

    result.push({
      id: connection.id,
      name: connection.name,
      aspspName: connection.aspspName,
      status: connection.status,
      validUntil: connection.validUntil,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
      diesPerCaducar:
        connection.validUntil === null
          ? null
          : daysBetween(today, connection.validUntil.toISOString().slice(0, 10)),
      accountList: await Promise.all(
        accountList.map(async (account) => ({
          id: account.id,
          name: account.name || account.product || ibanEmmascarat(account.iban),
          ibanMasked: ibanEmmascarat(account.iban),
          currency: account.currency,
          ledgerId: account.ledgerId,
          balance: (await lastBalance(account.id))?.amount ?? null,
          isActive: account.isActive,
        })),
      ),
    });
  }

  return result;
}

const activeWorkspaces = () =>
  db.select().from(ledgers).where(eq(ledgers.isActive, true)).orderBy(ledgers.position);

// --- Page ------------------------------------------------------------------

connectionsRoutes.get("/", async (c) => {
  const user = currentUser(c);
  const [connections, workspaces, meus] = await Promise.all([
    listConnections(),
    activeWorkspaces(),
    myWorkspaces(user.id),
  ]);

  const state = c.req.query("estat");
  const retorn =
    state === undefined ? undefined : { ok: state === "ok", motiu: c.req.query("motiu") ?? "" };

  return page(
    c,
    Layout({
      title: "Connexions",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      workspaces: meus,
      children: ConnectionsPage({ connections, workspaces, retorn }),
    }),
  );
});

// --- Authorization ---------------------------------------------------------

/**
 * Starts the authorization.
 *
 * This is an ordinary form, not HTMX: the response is a redirect **to the
 * bank**, and an `hx-post` would end up pasting the bank's page inside a
 * `<div>`. `redirect()` already takes care of it if you arrive over HTMX.
 */
connectionsRoutes.post("/autoritza", async (c) => {
  const user = currentUser(c);
  const parsed = authorizeSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) throw new AppError("Peticio no valida", 422);

  const { authorizationUrl } = await beginAuthorization({
    aspspName: parsed.data.aspsp_name,
    aspspCountry: parsed.data.aspsp_country,
    psuType: parsed.data.psu_type,
    connectionId: parsed.data.connection_id,
    userId: user.id,
  });

  return redirect(c, authorizationUrl);
});

/**
 * The return from the bank.
 *
 * **This route is unauthenticated and exempt from CSRF**, because whoever
 * arrives here comes from the bank and carries no token of ours. What
 * protects it is the single-use `eb_auth_state` that created the connection.
 * See `middleware/csrf.ts`.
 */
export const callbackRoute = new Hono();

callbackRoute.get("/api/auth/callback", async (c) => {
  const parsed = callbackSchema.safeParse(c.req.query());
  const base = `${config.publicBaseUrl}/connexions`;

  if (!parsed.success || parsed.data.error || !parsed.data.code || !parsed.data.state) {
    const motiu = encodeURIComponent(parsed.success ? (parsed.data.error ?? "") : "");
    return c.redirect(`${base}?estat=error&motiu=${motiu}`, 303);
  }

  try {
    await finishAuthorization(parsed.data.code, parsed.data.state);
    return c.redirect(`${base}?estat=ok`, 303);
  } catch (error) {
    const motiu = encodeURIComponent(error instanceof Error ? error.message : "desconegut");
    return c.redirect(`${base}?estat=error&motiu=${motiu}`, 303);
  }
});

// --- Synchronization -------------------------------------------------------

async function lastRun(connectionId: number): Promise<SyncRun | null> {
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, connectionId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return run ?? null;
}

connectionsRoutes.post("/:id/sincronitza", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquesta connexio no existeix");
  const parsed = syncSchema.safeParse(await c.req.parseBody());

  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.id, id))
    .limit(1);
  if (!connection) throw new NotFoundError("Aquesta connexio no existeix");

  if (connection.status !== "active") {
    return toastOnly(c, "Aquesta connexio no esta activa", 422);
  }

  // Under PSD2 the bank limits queries made without the user present, and two
  // imports of the same connection at once spend them twice over. If one is
  // already alive, that is the one shown.
  if (await alreadySyncing(id)) {
    return fragment(c, SyncState({ connectionId: id, run: await lastRun(id) }));
  }

  // The row is created **before** answering, so the fragment can already carry
  // the poll; the real work goes in the background, because the first import
  // can take longer than any proxy will wait.
  const run = await openImport(connection, "manual");

  void runTheImport(connection, run, {
    daysBack: parsed.success ? parsed.data.days_back : null,
  }).catch((error: unknown) => {
    console.error("[sync] la importacio ha fallat:", error);
  });

  return fragment(c, SyncState({ connectionId: id, run: run ?? null }));
});

/** The state of an import. The fragment stops by itself when the job ends. */
connectionsRoutes.get("/:id/fragment/sync", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquesta connexio no existeix");
  // The attempt counter comes in the URL: the poll has a limit and the server
  // holds it, not the client. See `lib/sondeig.ts`.
  const attempt = attemptFromQuery(c.req.query(ATTEMPT_PARAM));
  return fragment(c, SyncState({ connectionId: id, run: await lastRun(id), attempt }));
});

// --- Accounts --------------------------------------------------------------

/**
 * Assigns an account to a workspace.
 *
 * The work is done by `moveAccountToWorkspace()`: it is delicate enough —it
 * touches the account's whole history— not to live inside a route handler.
 */
connectionsRoutes.post("/comptes/:id/espai", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquesta connexio no existeix");
  const parsed = assignSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) throw new AppError("Peticio no valida", 422);

  const summary = await moveAccountToWorkspace(id, parsed.data.ledger_id);

  const [workspaces, connections] = await Promise.all([activeWorkspaces(), listConnections()]);
  const view = connections
    .flatMap((con) => con.accountList)
    .find((compteVista) => compteVista.id === id);

  if (!view) throw new NotFoundError("Aquest compte no existeix");

  return fragment(
    c,
    await withOob(
      AccountRow({ account: view, workspaces }),
      toast(moveMessage(parsed.data.ledger_id, summary), "success"),
    ),
  );
});

/** What happened, said in one line. */
function moveMessage(newWorkspace: number | null, summary: TransactionSummary): string {
  if (newWorkspace === null) return "El compte ja no pertany a cap espai";

  const parts = [`${summary.moguts} moviments moguts`];
  if (summary.conservades > 0) {
    parts.push(`${summary.conservades} amb la categoria que hi havies posat`);
  }
  if (summary.undoneTransfers > 0) {
    parts.push(`${summary.undoneTransfers} traspassos desfets a l'espai anterior`);
  }
  return parts.join(", ");
}

export { List };
