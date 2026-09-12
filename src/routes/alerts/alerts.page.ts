/**
 * Pagina d'avisos.
 */

import { html } from "hono/html";

import type { Alert } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { FilterBar, AlertsList } from "./alerts.fragment.ts";
import type { AlertFilters } from "./alerts.schema.ts";

export interface AlertsPageProps {
  codi: string;
  alertList: Alert[];
  filters: AlertFilters;
}

export function AlertsPage({ codi, alertList, filters }: AlertsPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Avisos</h1>
      <p class="text-suau">
        Els genera l'aplicacio sola: un descobert previst, un consentiment a
        punt de caducar, un rebut que no ha arribat. Descartar-ne un vol dir que
        no tornara.
      </p>
    </header>

    ${FilterBar({ codi, filters })} ${AlertsList({ codi, alertList, filters })}
  ` as Html;
}
