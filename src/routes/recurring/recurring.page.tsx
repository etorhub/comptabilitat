/**
 * Pagina de recurrents.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { ResumSubscripcions, SerieVista } from "../../services/recurring-list.ts";
import { BarraFiltres, ResumSubscripcionsFragment, Taula } from "./recurring.fragment.tsx";
import type { RecurringFilters } from "./recurring.schema.ts";

export interface RecurringPageProps {
  codi: string;
  series: SerieVista[];
  resum: ResumSubscripcions;
  filters: RecurringFilters;
  potEditar: boolean;
}

export function RecurringPage(props: RecurringPageProps): Html {
  const { codi, series, resum, filters, potEditar } = props;

  return html`
    <header class="capçalera">
      <h1>Recurrents</h1>
      <p class="text-suau">
        Rebuts i subscripcions que s'han detectat sols per la regularitat dels
        intervals i l'estabilitat de l'import. Son la base de la previsio de
        saldo.
      </p>
    </header>

    ${ResumSubscripcionsFragment({ resum })}
    ${BarraFiltres({ codi, filters })}
    ${Taula({ codi, series, potEditar })}
  ` as Html;
}
