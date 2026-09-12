/**
 * Bank connections page.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { ConnectForm, List, type ConnectionView } from "./connections.fragment.ts";

export interface ConnectionsPageProps {
  connections: ConnectionView[];
  workspaces: Ledger[];
  callbackResult?: { ok: boolean; reason: string } | undefined;
}

export function ConnectionsPage({
  connections,
  workspaces,
  callbackResult,
}: ConnectionsPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Connexions bancaries</h1>
      <p class="text-suau">
        Les connexions son de la instal·lacio, no de cap espai. El que pertany a
        un espai es el <strong>compte</strong>, i s'hi assigna aqui sota.
      </p>
    </header>

    ${
      callbackResult
        ? callbackResult.ok
          ? html`<p class="form-ok" role="status">
            El banc s'ha connectat. Assigna cada compte al seu espai i despres
            prem «Sincronitza».
          </p>`
          : html`<p class="form-error" role="alert">
            El banc no ha completat l'autoritzacio${callbackResult.reason ? html`: ${callbackResult.reason}` : ""}.
          </p>`
        : ""
    }

    ${ConnectForm()} ${List({ connections, workspaces })}
  ` as Html;
}
