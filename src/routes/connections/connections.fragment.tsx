/**
 * Fragments de les connexions bancaries.
 */

import { html, raw } from "hono/html";

import { Tria } from "../../components/form.tsx";
import type { ConnectionStatus, Ledger, SyncRun } from "../../db/schema/index.ts";
import { isSyncFinished } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";

const ESTATS: Record<ConnectionStatus, { text: string; classe: string }> = {
  pending: { text: "pendent d'autoritzar", classe: "etiqueta-suau" },
  active: { text: "activa", classe: "" },
  expired: { text: "consentiment caducat", classe: "etiqueta-perill" },
  revoked: { text: "revocada", classe: "etiqueta-suau" },
  error: { text: "amb error", classe: "etiqueta-perill" },
};

export interface CompteVista {
  id: number;
  name: string;
  ibanMasked: string;
  currency: string;
  ledgerId: number | null;
  saldo: string | null;
  isActive: boolean;
}

export interface ConnexioVista {
  id: number;
  name: string;
  aspspName: string;
  status: ConnectionStatus;
  validUntil: Date | null;
  lastSyncAt: Date | null;
  lastError: string;
  diesPerCaducar: number | null;
  comptes: CompteVista[];
}

export interface LlistaProps {
  connexions: ConnexioVista[];
  espais: Ledger[];
  oob?: boolean;
}

export function Llista({ connexions, espais, oob = false }: LlistaProps): Html {
  return html`<div id="llista-connexions" ${oob ? raw('hx-swap-oob="true"') : ""}>
    ${connexions.length === 0
      ? html`<p class="buit text-suau">
          Encara no hi ha cap banc connectat.
        </p>`
      : connexions.map((connexio) => Targeta({ connexio, espais }))}
  </div>` as Html;
}

export function Targeta({
  connexio,
  espais,
}: {
  connexio: ConnexioVista;
  espais: Ledger[];
}): Html {
  const estat = ESTATS[connexio.status];
  const base = `/connexions/${connexio.id}`;

  return html`<section id="connexio-${connexio.id}" class="superficie targeta">
    <div class="item-cap">
      <strong>${connexio.aspspName}</strong>
      <span class="etiqueta ${estat.classe}">${estat.text}</span>
      ${connexio.diesPerCaducar !== null && connexio.status === "active"
        ? html`<span class="text-suau">
            caduca ${connexio.diesPerCaducar <= 0 ? "avui" : `en ${connexio.diesPerCaducar} dies`}
          </span>`
        : ""}
      ${connexio.lastSyncAt
        ? html`<span class="text-suau">
            ultima importacio ${formatDate(connexio.lastSyncAt.toISOString().slice(0, 10))}
          </span>`
        : ""}
    </div>

    ${connexio.lastError
      ? html`<p class="form-error" role="alert">${connexio.lastError}</p>`
      : ""}

    <div class="form-accions">
      <form hx-post="${base}/sincronitza" hx-target="#sync-${connexio.id}" hx-swap="outerHTML">
        <button
          type="submit"
          class="boto"
          ${connexio.status !== "active" ? raw("disabled") : ""}
        >
          Sincronitza
        </button>
      </form>

      <form method="post" action="/connexions/autoritza">
        <input type="hidden" name="connection_id" value="${connexio.id}" />
        <button type="submit" class="boto boto-discret">Renova el consentiment</button>
      </form>
    </div>

    <div id="sync-${connexio.id}"></div>

    ${TaulaComptes({ comptes: connexio.comptes, espais })}
  </section>` as Html;
}

export function TaulaComptes({
  comptes,
  espais,
}: {
  comptes: CompteVista[];
  espais: Ledger[];
}): Html {
  if (comptes.length === 0) {
    return html`<p class="text-suau nota">
      Encara no s'ha importat cap compte d'aquesta connexio.
    </p>` as Html;
  }

  return html`<div class="desplaçable">
    <table class="dades">
      <thead>
        <tr>
          <th>Compte</th>
          <th class="dreta">Saldo</th>
          <th>Espai</th>
        </tr>
      </thead>
      <tbody>
        ${comptes.map((compte) => FilaCompte({ compte, espais }))}
      </tbody>
    </table>
  </div>` as Html;
}

export function FilaCompte({
  compte,
  espais,
}: {
  compte: CompteVista;
  espais: Ledger[];
}): Html {
  return html`<tr id="compte-${compte.id}">
    <td>
      <span class="nom">${compte.name}</span><br />
      <small class="text-suau">${compte.ibanMasked}</small>
    </td>
    <td class="dreta">
      ${compte.saldo !== null ? formatMoney(compte.saldo) : html`<span class="text-suau">—</span>`}
    </td>
    <td>
      ${Tria({
        nom: "ledger_id",
        etiqueta: `Espai del compte ${compte.name}`,
        valor: compte.ledgerId,
        opcions: espais.map((e) => ({ valor: e.id, text: e.name })),
        buit: "— sense assignar —",
        atributs: `hx-post="/connexions/comptes/${compte.id}/espai" hx-target="#compte-${compte.id}" hx-swap="outerHTML" hx-trigger="change" hx-confirm="Moure un compte d'espai n'esborra les classificacions i les torna a calcular. Vols continuar?"`,
      })}
      ${compte.ledgerId === null
        ? html`<small class="text-suau">
            Mentre no tingui espai, els seus moviments no es veuen enlloc.
          </small>`
        : ""}
    </td>
  </tr>` as Html;
}

/**
 * L'estat d'una importacio en curs.
 *
 * **Aquest es l'unic sondeig de tota l'aplicacio**, i s'atura sol: mentre la
 * feina corre, el fragment porta `hx-trigger="every 2s"`; quan acaba, el
 * fragment que es torna ja no en porta, i HTMX deixa de preguntar.
 */
export function EstatSync({
  connexioId,
  execucio,
}: {
  connexioId: number;
  execucio: SyncRun | null;
}): Html {
  if (execucio === null) {
    return html`<div id="sync-${connexioId}"></div>` as Html;
  }

  const acabada = isSyncFinished(execucio.status);

  return html`<div
    id="sync-${connexioId}"
    class="sync-estat ${acabada ? "" : "sync-corrent"}"
    ${acabada
      ? ""
      : raw(
          `hx-get="/connexions/${connexioId}/fragment/sync" hx-target="#sync-${connexioId}" hx-swap="outerHTML" hx-trigger="every 2s"`,
        )}
    role="status"
    aria-live="polite"
  >
    ${acabada
      ? html`
          <strong>${execucio.status === "failed" ? "Ha fallat" : "Fet"}</strong>
          <span class="text-suau">
            ${String(execucio.transactionsInserted)} moviments nous,
            ${String(execucio.transactionsUpdated)} actualitzats,
            ${String(execucio.accountsSynced)} comptes
          </span>
          ${execucio.error ? html`<small class="text-suau">${execucio.error}</small>` : ""}
        `
      : html`
          <span class="filador" aria-hidden="true"></span>
          <span>Important els moviments del banc…</span>
        `}
  </div>` as Html;
}

export function FormConnecta(): Html {
  return html`<form method="post" action="/connexions/autoritza" class="superficie targeta">
    <h2>Connecta un banc</h2>
    <p class="text-suau">
      T'enviara al banc perque hi facis l'autenticacio forta i triïs quins
      comptes comparteixes. En tornar, els comptes surten <strong>sense espai
      assignat</strong>: fins que no n'hi posis un, els seus moviments no es
      veuen enlloc.
    </p>
    <div class="form-accions">
      <button type="submit" class="boto">Connecta un banc</button>
    </div>
  </form>` as Html;
}
