/**
 * Pagina de configuracio de l'espai.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { FormEspai, TaulaMembres, type MembreVista } from "./workspaces.fragment.tsx";

export interface WorkspacePageProps {
  espai: Ledger;
  membres: MembreVista[];
  potConfigurar: boolean;
}

export function WorkspacePage({ espai, membres, potConfigurar }: WorkspacePageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Configuracio</h1>
      <p class="text-suau">
        El que hi ha aqui val nomes per a aquest espai: el llindar de descobert i
        els destinataris dels avisos no en toquen cap altre.
      </p>
    </header>

    ${potConfigurar
      ? FormEspai({ espai })
      : html`<p class="text-suau">
          Cal ser administrador d'aquest espai per canviar-ne la configuracio.
        </p>`}
    ${TaulaMembres({ membres })}
  ` as Html;
}
