/**
 * Pagina de connexions bancaries.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { FormConnecta, Llista, type ConnexioVista } from "./connections.fragment.tsx";

export interface ConnectionsPageProps {
  connexions: ConnexioVista[];
  espais: Ledger[];
  retorn?: { ok: boolean; motiu: string } | undefined;
}

export function ConnectionsPage({ connexions, espais, retorn }: ConnectionsPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Connexions bancaries</h1>
      <p class="text-suau">
        Les connexions son de la instal·lacio, no de cap espai. El que pertany a
        un espai es el <strong>compte</strong>, i s'hi assigna aqui sota.
      </p>
    </header>

    ${retorn
      ? retorn.ok
        ? html`<p class="form-ok" role="status">
            El banc s'ha connectat. Assigna cada compte al seu espai i despres
            prem «Sincronitza».
          </p>`
        : html`<p class="form-error" role="alert">
            El banc no ha completat l'autoritzacio${retorn.motiu ? html`: ${retorn.motiu}` : ""}.
          </p>`
      : ""}

    ${FormConnecta()} ${Llista({ connexions, espais })}
  ` as Html;
}
