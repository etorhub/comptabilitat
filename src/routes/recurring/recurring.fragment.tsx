/**
 * Fragments de les series recurrents.
 */

import { html, raw } from "hono/html";

import type { Cadence } from "../../db/schema/index.ts";
import { Casella } from "../../components/form.tsx";
import { TaulaDades } from "../../components/vista.tsx";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { ResumSubscripcions, SerieVista } from "../../services/recurring-list.ts";
import type { RecurringFilters } from "./recurring.schema.ts";

const CADENCIES: Record<Cadence, string> = {
  weekly: "setmanal",
  biweekly: "quinzenal",
  monthly: "mensual",
  bimonthly: "bimensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
};

export interface ResumProps {
  resum: ResumSubscripcions;
  /** Torna'l fora de banda quan el canvi ve d'una fila. */
  oob?: boolean;
}

/**
 * El resum de subscripcions es un objectiu fora de banda: canvia quan una
 * serie deixa de ser subscripcio o quan surt de la previsio.
 */
export function ResumSubscripcionsFragment({ resum, oob = false }: ResumProps): Html {
  return html`<div
    id="resum-subscripcions"
    class="xifres"
    ${oob ? raw('hx-swap-oob="true"') : ""}
  >
    <div class="xifra">
      <span class="xifra-etiqueta">Subscripcions al mes</span>
      <strong class="xifra-valor">${formatMoney(resum.mensual)}</strong>
    </div>
    <div class="xifra">
      <span class="xifra-etiqueta">A l'any</span>
      <strong class="xifra-valor">${formatMoney(resum.anual)}</strong>
    </div>
  </div>` as Html;
}

export interface TaulaProps {
  codi: string;
  series: SerieVista[];
  potEditar: boolean;
}

export function Taula({ codi, series, potEditar }: TaulaProps): Html {
  return html`<div id="taula-recurrents">
    ${TaulaDades({
      columnes: html`<th>Serie</th>
        <th>Cadencia</th>
        <th class="dreta">Import</th>
        <th class="dreta">Al mes</th>
        <th>Seguent</th>
        <th class="dreta">Confiança</th>
        <th>A la previsio</th>` as Html,
      files: series.map((serie) => Fila({ codi, serie, potEditar })),
      buit: html`Encara no s'ha detectat cap serie. Calen com a minim tres aparicions a
      intervals regulars perque una despesa es reconegui com a rebut.` as Html,
    })}
  </div>` as Html;
}

export function Fila({
  codi,
  serie,
  potEditar,
}: {
  codi: string;
  serie: SerieVista;
  potEditar: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${serie.id}`;

  return html`<tr id="serie-${serie.id}" class="${serie.status === "ended" ? "inactiva" : ""}">
    <td>
      <span class="nom">${serie.label}</span>
      ${
        serie.isSubscription
          ? html`<span class="etiqueta" title="Despesa mensual regular">subscripcio</span>`
          : ""
      }
      ${
        serie.status === "ended"
          ? html`<span class="etiqueta etiqueta-suau">acabada</span>`
          : ""
      }
      ${
        serie.categoryName
          ? html`<br /><small class="text-suau">${serie.categoryName}</small>`
          : ""
      }
    </td>
    <td>${CADENCIES[serie.cadence]}</td>
    <td class="dreta">${formatMoney(serie.expectedAmount)}</td>
    <td class="dreta">${formatMoney(serie.monthlyCost)}</td>
    <td>
      ${
        serie.nextExpectedDate
          ? html`<time datetime="${serie.nextExpectedDate}">
            ${formatDate(serie.nextExpectedDate)}
          </time>`
          : html`<span class="text-suau">—</span>`
      }
    </td>
    <td class="dreta" title="${String(serie.occurrencesCount)} aparicions">
      ${String(Math.round(serie.confidence * 100))}%
    </td>
    <td>
      ${
        potEditar
          ? html`<input
            type="checkbox"
            name="include_in_forecast"
            ${serie.includeInForecast ? raw("checked") : ""}
            aria-label="Inclou ${serie.label} a la previsio"
            hx-post="${base}/previsio"
            hx-target="#serie-${serie.id}"
            hx-swap="outerHTML"
          />`
          : serie.includeInForecast
            ? "Si"
            : "No"
      }
    </td>
  </tr>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: RecurringFilters;
}

export function BarraFiltres({ codi, filters }: BarraFiltresProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${codi}/recurrents/fragment/taula"
    hx-target="#taula-recurrents"
    hx-swap="outerHTML"
    hx-trigger="change"
  >
    ${Casella({
      nom: "nomes_subscripcions",
      valor: "1",
      etiqueta: "Nomes les subscripcions",
      marcat: filters.nomes_subscripcions,
    })}
    ${Casella({
      nom: "inclou_acabades",
      valor: "1",
      etiqueta: "Inclou les acabades",
      marcat: filters.inclou_acabades,
    })}
  </form>` as Html;
}
