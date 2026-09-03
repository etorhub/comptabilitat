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
 * de `sync_runs` en estat «running». El fragment que torna porta
 * `hx-trigger="every 2s"` sobre una ruta d'estat i, quan la feina acaba, el
 * fragment nou ja no en porta: el sondeig s'atura sol. **Es l'unic sondeig de
 * tota l'aplicacio i esta acotat.**
 *
 * No hi ha cua ni intermediari perque no calen: aixo es una instal·lacio d'una
 * sola maquina i el banc nomes deixa unes quantes crides al dia.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import { Layout } from "../../components/layout.tsx";
import { db } from "../../db/client.ts";
import {
  accounts,
  bankConnections,
  ledgers,
  syncRuns,
  transactions,
  type SyncRun,
} from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import {
  AppError,
  fragment,
  NotFoundError,
  page,
  redirect,
  toast,
  withOob,
} from "../../lib/http.ts";
import { daysBetween, todayLocal } from "../../lib/time.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { ultimSaldo } from "../../services/balances.ts";
import { classificaPendents } from "../../services/classification.ts";
import { obteOCreaComerc } from "../../services/merchants.ts";
import { normalizeDescription } from "../../services/normalization.ts";
import {
  acabaAutoritzacio,
  comencaAutoritzacio,
  sincronitzaConnexio,
} from "../../services/sync.ts";
import { EstatSync, FilaCompte, Llista, type ConnexioVista } from "./connections.fragment.tsx";
import { ConnectionsPage } from "./connections.page.tsx";
import {
  assignSchema,
  authorizeSchema,
  callbackSchema,
  syncSchema,
} from "./connections.schema.ts";

export const connectionsRoutes = new Hono();

function idDeLaRuta(valor: string | undefined): number {
  const id = Number.parseInt(valor ?? "", 10);
  if (Number.isNaN(id)) throw new NotFoundError("Aquesta connexio no existeix");
  return id;
}

/** L'IBAN nomes surt emmascarat. */
function ibanEmmascarat(iban: string): string {
  if (iban.length <= 8) return iban ? "····" : "";
  return `${iban.slice(0, 4)}····${iban.slice(-4)}`;
}

async function llistaConnexions(): Promise<ConnexioVista[]> {
  const connexions = await db
    .select()
    .from(bankConnections)
    .orderBy(desc(bankConnections.createdAt));

  const avui = todayLocal();
  const resultat: ConnexioVista[] = [];

  for (const connexio of connexions) {
    const comptes = await db
      .select()
      .from(accounts)
      .where(eq(accounts.connectionId, connexio.id))
      .orderBy(accounts.name);

    resultat.push({
      id: connexio.id,
      name: connexio.name,
      aspspName: connexio.aspspName,
      status: connexio.status,
      validUntil: connexio.validUntil,
      lastSyncAt: connexio.lastSyncAt,
      lastError: connexio.lastError,
      diesPerCaducar:
        connexio.validUntil === null
          ? null
          : daysBetween(avui, connexio.validUntil.toISOString().slice(0, 10)),
      comptes: await Promise.all(
        comptes.map(async (compte) => ({
          id: compte.id,
          name: compte.name || compte.product || ibanEmmascarat(compte.iban),
          ibanMasked: ibanEmmascarat(compte.iban),
          currency: compte.currency,
          ledgerId: compte.ledgerId,
          saldo: (await ultimSaldo(compte.id))?.amount ?? null,
          isActive: compte.isActive,
        })),
      ),
    });
  }

  return resultat;
}

const espaisActius = () =>
  db.select().from(ledgers).where(eq(ledgers.isActive, true)).orderBy(ledgers.position);

// --- Pagina ----------------------------------------------------------------

connectionsRoutes.get("/", async (c) => {
  const user = currentUser(c);
  const [connexions, espais, meus] = await Promise.all([
    llistaConnexions(),
    espaisActius(),
    myWorkspaces(user.id),
  ]);

  const estat = c.req.query("estat");
  const retorn =
    estat === undefined ? undefined : { ok: estat === "ok", motiu: c.req.query("motiu") ?? "" };

  return page(
    c,
    Layout({
      titol: "Connexions",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      espais: meus,
      children: ConnectionsPage({ connexions, espais, retorn }),
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

  const { authorizationUrl } = await comencaAutoritzacio({
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
    await acabaAutoritzacio(parsed.data.code, parsed.data.state);
    return c.redirect(`${base}?estat=ok`, 303);
  } catch (error) {
    const motiu = encodeURIComponent(error instanceof Error ? error.message : "desconegut");
    return c.redirect(`${base}?estat=error&motiu=${motiu}`, 303);
  }
});

// --- Sincronitzacio --------------------------------------------------------

async function ultimaExecucio(connexioId: number): Promise<SyncRun | null> {
  const [execucio] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, connexioId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return execucio ?? null;
}

connectionsRoutes.post("/:id/sincronitza", async (c) => {
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = syncSchema.safeParse(await c.req.parseBody());

  const [connexio] = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.id, id))
    .limit(1);
  if (!connexio) throw new NotFoundError("Aquesta connexio no existeix");

  if (connexio.status !== "active") {
    return fragment(c, toast("Aquesta connexio no esta activa"), 422);
  }

  // Arrenca en segon pla i contesta de seguida: la primera importacio pot
  // trigar mes del que aguanta cap intermediari.
  void sincronitzaConnexio(connexio, {
    trigger: "manual",
    daysBack: parsed.success ? parsed.data.days_back : null,
  }).catch((error: unknown) => {
    console.error("[sync] la importacio ha fallat:", error);
  });

  // Un moment perque la fila de `sync_runs` ja hi sigui.
  await Bun.sleep(150);

  return fragment(c, EstatSync({ connexioId: id, execucio: await ultimaExecucio(id) }));
});

/** L'estat d'una importacio. El fragment s'atura sol quan la feina acaba. */
connectionsRoutes.get("/:id/fragment/sync", async (c) => {
  const id = idDeLaRuta(c.req.param("id"));
  return fragment(c, EstatSync({ connexioId: id, execucio: await ultimaExecucio(id) }));
});

// --- Comptes ---------------------------------------------------------------

/**
 * Assigna un compte a un espai.
 *
 * Moure'l **no es una operacio per fer sovint**: les categories, els comerços
 * i les regles son de cada espai, de manera que les classificacions anteriors
 * deixen de ser valides. S'esborren, es tornen a crear els comerços dins de
 * l'espai nou i s'hi apliquen les seves regles; el que no encaixi queda a la
 * safata de revisio.
 */
connectionsRoutes.post("/comptes/:id/espai", async (c) => {
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = assignSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) throw new AppError("Peticio no valida", 422);

  const [compte] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!compte) throw new NotFoundError("Aquest compte no existeix");

  const nouEspai = parsed.data.ledger_id;

  if (nouEspai !== null) {
    const [espai] = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(eq(ledgers.id, nouEspai))
      .limit(1);
    if (!espai) throw new NotFoundError("Aquest espai no existeix");
  }

  if (nouEspai !== compte.ledgerId) {
    await db.update(accounts).set({ ledgerId: nouEspai }).where(eq(accounts.id, id));

    // Els moviments segueixen el compte, i perden tot el que era de l'espai
    // vell: categoria, comerç, regla aplicada i aparellament de traspassos.
    await db
      .update(transactions)
      .set({
        ledgerId: nouEspai,
        merchantId: null,
        categoryId: null,
        categorySource: "none",
        categoryConfidence: null,
        appliedRuleId: null,
        transferGroupId: null,
        needsReview: true,
      })
      .where(eq(transactions.accountId, id));

    if (nouEspai !== null) {
      // Es tornen a crear els comerços dins de l'espai nou.
      const seus = await db
        .select({
          id: transactions.id,
          description: transactions.description,
          counterparty: transactions.counterparty,
          bookingDate: transactions.bookingDate,
        })
        .from(transactions)
        .where(and(eq(transactions.accountId, id), isNull(transactions.merchantId)));

      for (const moviment of seus) {
        const [normalitzat, mostrar] = normalizeDescription(
          moviment.description,
          moviment.counterparty,
        );
        if (!normalitzat) continue;

        const comerc = await obteOCreaComerc(
          nouEspai,
          normalitzat,
          mostrar,
          moviment.bookingDate,
        );
        await db
          .update(transactions)
          .set({
            normalizedDescription: normalitzat.slice(0, 200),
            merchantId: comerc?.id ?? null,
          })
          .where(eq(transactions.id, moviment.id));
      }

      await classificaPendents(nouEspai);
    }
  }

  const [espais, connexions] = await Promise.all([espaisActius(), llistaConnexions()]);
  const vista = connexions
    .flatMap((con) => con.comptes)
    .find((compteVista) => compteVista.id === id);

  if (!vista) throw new NotFoundError("Aquest compte no existeix");

  return fragment(
    c,
    await withOob(
      FilaCompte({ compte: vista, espais }),
      toast(
        nouEspai === null
          ? "El compte ja no pertany a cap espai"
          : "Compte mogut i moviments tornats a classificar",
        "success",
      ),
    ),
  );
});

export { Llista };
