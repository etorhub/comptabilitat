/**
 * Connexions bancaries. Nomes per a administradors de la instal·lacio.
 *
 * DECISIO SOBRE LA SINCRONITZACIO. A l'aplicacio de Python, prémer
 * «Sincronitza» feia la importacio sencera **dins de la peticio HTTP**, sense
 * cap limit de temps (`routes/connections.py:127`). Amb el
 * `proxy_read_timeout 300s` de l'nginx que hi ha al davant, una primera
 * importacio de 24 mesos d'historic es un 502 esperant a passar.
 *
 * Aqui la feina arrenca en segon pla i la ruta contesta de seguida amb la fila
 * de `sync_runs` en estat «running». El fragment que torna sondeja una ruta
 * d'estat i, quan la feina acaba, el fragment nou ja no duu disparador: el
 * sondeig s'atura sol. Si la feina no acaba mai, l'atura el compte d'intents.
 * **Es un dels dos sondejos de l'aplicacio** (amb el d'en curs a `/feines`).
 *
 * No hi ha cua ni intermediari perque no calen: aixo es una instal·lacio d'una
 * sola maquina i el banc nomes deixa unes quantes crides al dia.
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

/** L'IBAN nomes surt emmascarat. */
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

// --- Pagina ----------------------------------------------------------------

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

// --- Autoritzacio ----------------------------------------------------------

/**
 * Comença l'autoritzacio.
 *
 * Es un formulari normal, no HTMX: la resposta es una redireccio **cap al
 * banc**, i un `hx-post` acabaria enganxant la pagina del banc dins d'un
 * `<div>`. `redirect()` ja se'n cuida si arribes per HTMX.
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
 * El retorn del banc.
 *
 * **Aquesta ruta no va autenticada i esta exempta de CSRF**, perque qui hi
 * arriba ve del banc i no duu cap testimoni nostre. El que la protegeix es
 * l'`eb_auth_state` d'un sol us que va generar la connexio. Vegeu
 * `middleware/csrf.ts`.
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

// --- Sincronitzacio --------------------------------------------------------

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

  // Sota PSD2 el banc limita les consultes sense l'usuari present, i dues
  // importacions alhora de la mateixa connexio se les gasten per duplicat.
  // Si ja n'hi ha una de viva, s'ensenya aquella.
  if (await alreadySyncing(id)) {
    return fragment(c, SyncState({ connectionId: id, run: await lastRun(id) }));
  }

  // La fila es crea **abans** de contestar, de manera que el fragment ja pot
  // dur el sondeig; la feina de debo va en segon pla, perque la primera
  // importacio pot trigar mes del que aguanta cap intermediari.
  const run = await openImport(connection, "manual");

  void runTheImport(connection, run, {
    daysBack: parsed.success ? parsed.data.days_back : null,
  }).catch((error: unknown) => {
    console.error("[sync] la importacio ha fallat:", error);
  });

  return fragment(c, SyncState({ connectionId: id, run: run ?? null }));
});

/** L'estat d'una importacio. El fragment s'atura sol quan la feina acaba. */
connectionsRoutes.get("/:id/fragment/sync", async (c) => {
  const id = idFromRoute(c.req.param("id"), "Aquesta connexio no existeix");
  // El compte d'intents ve a l'adreça: el sondeig te limit i el porta el
  // servidor, no el client. Vegeu `lib/sondeig.ts`.
  const attempt = attemptFromQuery(c.req.query(ATTEMPT_PARAM));
  return fragment(c, SyncState({ connectionId: id, run: await lastRun(id), attempt }));
});

// --- Comptes ---------------------------------------------------------------

/**
 * Assigna un compte a un espai.
 *
 * La feina la fa `mouCompteDEspai()`: es prou delicada —toca l'historial
 * sencer del compte— per no viure dins d'un gestor de ruta.
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

/** Que ha passat, dit en una linia. */
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
