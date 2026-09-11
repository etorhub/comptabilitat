/**
 * Pagina de recurrents (schedules).
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { SerieVista } from "../../services/recurring-list.ts";
import { BarraFiltres, FormAlta, Taula } from "./recurring.fragment.ts";
import type { RecurringFilters } from "./recurring.schema.ts";

export interface RecurringPageProps {
  codi: string;
  propostes: SerieVista[];
  actives: SerieVista[];
  filters: RecurringFilters;
  potEditar: boolean;
  grups: GrupCategories[];
}

export function RecurringPage(props: RecurringPageProps): Html {
  const { codi, propostes, actives, filters, potEditar, grups } = props;

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
          ${FormAlta({ codi, grups })}
        </section>`
        : ""
    }

    <section class="superficie targeta">
      <h2>Propostes</h2>
      ${Taula({
        codi,
        series: propostes,
        potEditar,
        idContenidor: "taula-recurrents-propostes",
        sonPropostes: true,
        buit: "No hi ha cap proposta nova. Quan hi hagi tres aparicions regulars d'un mateix concepte categoritzat, apareixeran aqui.",
      })}
    </section>

    <section class="superficie targeta">
      <h2>Confirmats</h2>
      ${BarraFiltres({ codi, filters })}
      ${Taula({
        codi,
        series: actives,
        potEditar,
        idContenidor: "taula-recurrents-actives",
        buit: "Encara no hi ha cap rebut confirmat. Confirma una proposta de dalt o afegeix-ne un a ma.",
      })}
    </section>
  ` as Html;
}
