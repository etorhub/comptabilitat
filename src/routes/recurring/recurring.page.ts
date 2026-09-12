/**
 * Pagina de recurrents (schedules).
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { SeriesView } from "../../services/recurring-list.ts";
import { FilterBar, CreateForm, Table } from "./recurring.fragment.ts";
import type { RecurringFilters } from "./recurring.schema.ts";

export interface RecurringPageProps {
  codi: string;
  proposals: SeriesView[];
  active: SeriesView[];
  filters: RecurringFilters;
  potEditar: boolean;
  groups: CategoryGroup[];
}

export function RecurringPage(props: RecurringPageProps): Html {
  const { codi, proposals, active, filters, potEditar, groups } = props;

  return html`
    <header class="capçalera">
      <h1>Recurrents</h1>
      <p class="text-suau">
        Rebuts previstos per a la previsio de saldo. El sistema en proposa a
        partir de l'historic; cal confirmar-los abans que entri a la previsio.
        L'import pot ser fix (lloguer, sou) o la mitjana recent (aigua, llum).
        Tambe se'n pot afegir un a ma.
      </p>
    </header>

    ${
      potEditar
        ? html`<section class="superficie targeta">
          <h2>Afegeix un recurrent</h2>
          ${CreateForm({ codi, groups })}
        </section>`
        : ""
    }

    <section class="superficie targeta">
      <h2>Propostes</h2>
      ${Table({
        codi,
        series: proposals,
        potEditar,
        idContenidor: "taula-recurrents-propostes",
        sonPropostes: true,
        empty:
          "No hi ha cap proposta nova. Quan hi hagi tres aparicions regulars d'un mateix concepte categoritzat, apareixeran aqui.",
      })}
    </section>

    <section class="superficie targeta">
      <h2>Confirmats</h2>
      ${FilterBar({ codi, filters })}
      ${Table({
        codi,
        series: active,
        potEditar,
        idContenidor: "taula-recurrents-actives",
        empty:
          "Encara no hi ha cap rebut confirmat. Confirma una proposta de dalt o afegeix-ne un a ma.",
      })}
    </section>
  ` as Html;
}
