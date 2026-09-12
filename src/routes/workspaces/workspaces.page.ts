/**
 * Pagina de configuracio de l'espai.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { WorkspaceForm, MembersTable, type MemberView } from "./workspaces.fragment.ts";

export interface WorkspacePageProps {
  workspace: Ledger;
  members: MemberView[];
  potConfigurar: boolean;
}

export function WorkspacePage({ workspace, members, potConfigurar }: WorkspacePageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Espai</h1>
      <p class="text-suau">
        El que hi ha aqui val nomes per a aquest espai: el llindar de descobert i
        els destinataris dels avisos no en toquen cap altre.
      </p>
    </header>

    ${
      potConfigurar
        ? WorkspaceForm({ workspace })
        : html`<p class="text-suau">
          Cal ser administrador d'aquest espai per canviar-ne la configuracio.
        </p>`
    }
    ${MembersTable({ members })}
  ` as Html;
}
