/**
 * Fragments de les connexions bancaries.
 */

import { html, raw } from "hono/html";

import { Select } from "../../components/form.ts";
import type { ConnectionStatus, Ledger, SyncRun } from "../../db/schema/index.ts";
import { isSyncFinished } from "../../db/schema/index.ts";
import { EmptyState, Spinner, DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import { oobAttributes } from "../../lib/oob.ts";
import { poll, pollExhausted } from "../../lib/sondeig.ts";

const ESTATS: Record<ConnectionStatus, { text: string; cssClass: string }> = {
  pending: { text: "pendent d'autoritzar", cssClass: "etiqueta-suau" },
  active: { text: "activa", cssClass: "" },
  expired: { text: "consentiment caducat", cssClass: "etiqueta-perill" },
  revoked: { text: "revocada", cssClass: "etiqueta-suau" },
  error: { text: "amb error", cssClass: "etiqueta-perill" },
};

export interface AccountView {
  id: number;
  name: string;
  ibanMasked: string;
  currency: string;
  ledgerId: number | null;
  balance: string | null;
  isActive: boolean;
}

export interface ConnectionView {
  id: number;
  name: string;
  aspspName: string;
  status: ConnectionStatus;
  validUntil: Date | null;
  lastSyncAt: Date | null;
  lastError: string;
  diesPerCaducar: number | null;
  accountList: AccountView[];
}

export interface ListProps {
  connections: ConnectionView[];
  workspaces: Ledger[];
  oob?: boolean;
}

export function List({ connections, workspaces, oob = false }: ListProps): Html {
  return html`<div ${oobAttributes("llista-connexions", oob)}>
    ${
      connections.length === 0
        ? EmptyState("Encara no hi ha cap banc connectat.")
        : connections.map((connection) => Card({ connection, workspaces }))
    }
  </div>` as Html;
}

export function Card({
  connection,
  workspaces,
}: {
  connection: ConnectionView;
  workspaces: Ledger[];
}): Html {
  const state = ESTATS[connection.status];
  const base = `/connexions/${connection.id}`;

  return html`<section id="connexio-${connection.id}" class="superficie targeta">
    <div class="item-cap">
      <strong>${connection.aspspName}</strong>
      <span class="etiqueta ${state.cssClass}">${state.text}</span>
      ${
        connection.diesPerCaducar !== null && connection.status === "active"
          ? html`<span class="text-suau">
            caduca ${connection.diesPerCaducar <= 0 ? "avui" : `en ${connection.diesPerCaducar} dies`}
          </span>`
          : ""
      }
      ${
        connection.lastSyncAt
          ? html`<span class="text-suau">
            ultima importacio ${formatDate(connection.lastSyncAt.toISOString().slice(0, 10))}
          </span>`
          : ""
      }
    </div>

    ${
      connection.lastError
        ? html`<p class="form-error" role="alert">${connection.lastError}</p>`
        : ""
    }

    <div class="form-accions">
      <form hx-post="${base}/sincronitza" hx-target="#sync-${connection.id}" hx-swap="outerHTML">
        <button
          type="submit"
          class="boto"
          hx-indicator="this"
          hx-disabled-elt="this"
          ${connection.status !== "active" ? raw("disabled") : ""}
        >
          ${Spinner()} Sincronitza
        </button>
      </form>

      <form method="post" action="/connexions/autoritza">
        <input type="hidden" name="connection_id" value="${connection.id}" />
        <button type="submit" class="boto boto-discret">Renova el consentiment</button>
      </form>
    </div>

    <div id="sync-${connection.id}"></div>

    ${AccountsTable({ accountList: connection.accountList, workspaces })}
  </section>` as Html;
}

export function AccountsTable({
  accountList,
  workspaces,
}: {
  accountList: AccountView[];
  workspaces: Ledger[];
}): Html {
  return DataTable({
    columnes: html`<th>Compte</th>
      <th class="dreta">Saldo</th>
      <th>Espai</th>` as Html,
    rows: accountList.map((account) => AccountRow({ account, workspaces })),
    empty: "Encara no s'ha importat cap compte d'aquesta connexio.",
  });
}

export function AccountRow({
  account,
  workspaces,
}: {
  account: AccountView;
  workspaces: Ledger[];
}): Html {
  return html`<tr id="compte-${account.id}">
    <td>
      <span class="nom">${account.name}</span><br />
      <small class="text-suau">${account.ibanMasked}</small>
    </td>
    <td class="dreta">
      ${account.balance !== null ? formatMoney(account.balance) : html`<span class="text-suau">—</span>`}
    </td>
    <td>
      ${Select({
        name: "ledger_id",
        id: `espai-compte-${account.id}`,
        tag: `Espai del compte ${account.name}`,
        value: account.ledgerId,
        options: workspaces.map((e) => ({ value: e.id, text: e.name })),
        empty: "— sense assignar —",
        // Es la peticio mes llarga de l'aplicacio —centenars de moviments
        // reclassificats— i fins ara no es veia que estigues passant res.
        attributes: `hx-post="/connexions/comptes/${account.id}/espai" hx-target="#compte-${account.id}" hx-swap="outerHTML" hx-trigger="change" hx-disabled-elt="this" hx-confirm="Moure un compte d'espai n'esborra les classificacions i les torna a calcular. Vols continuar?"`,
      })}
      ${
        account.ledgerId === null
          ? html`<small class="text-suau">
            Mentre no tingui espai, els seus moviments no es veuen enlloc.
          </small>`
          : ""
      }
    </td>
  </tr>` as Html;
}

/**
 * L'estat d'una importacio en curs.
 *
 * **Aquest es un dels dos sondejos de l'aplicacio** (amb el d'en curs a
 * `/feines`), i s'atura de dues maneres: quan la feina acaba, el fragment que
 * es torna ja no duu disparador; i si no acaba mai, el compte d'intents
 * s'exhaureix i es diu. Aquesta segona xarxa hi es perque la primera no
 * serveix de res quan el proces mor enmig i la fila es queda en `running` per
 * sempre. Vegeu `lib/sondeig.ts`.
 */
export function SyncState({
  connectionId,
  run,
  attempt = 0,
}: {
  connectionId: number;
  run: SyncRun | null;
  attempt?: number;
}): Html {
  if (run === null) {
    return html`<div id="sync-${connectionId}"></div>` as Html;
  }

  const acabada = isSyncFinished(run.status);
  const exhausted = !acabada && pollExhausted(attempt);

  return html`<div
    id="sync-${connectionId}"
    class="sync-estat ${acabada ? "" : "sync-corrent"}"
    ${
      acabada
        ? ""
        : poll({
            url: `/connexions/${connectionId}/fragment/sync`,
            target: `#sync-${connectionId}`,
            attempt,
          })
    }
    role="status"
    aria-live="polite"
  >
    ${
      exhausted
        ? html`<strong>S'ha deixat de comprovar</strong>
          <span class="text-suau">
            Fa massa estona que dura. El manteniment de cada nit tanca les
            importacions encallades; recarrega la pagina per tornar-hi.
          </span>`
        : ""
    }
    ${
      acabada
        ? html`
          <strong>${run.status === "failed" ? "Ha fallat" : "Fet"}</strong>
          <span class="text-suau">
            ${String(run.transactionsInserted)} moviments nous,
            ${String(run.transactionsUpdated)} actualitzats,
            ${String(run.accountsSynced)} comptes
          </span>
          ${run.error ? html`<small class="text-suau">${run.error}</small>` : ""}
        `
        : html`
          <span class="filador" aria-hidden="true"></span>
          <span>Important els moviments del banc…</span>
        `
    }
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
