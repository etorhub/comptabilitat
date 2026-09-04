/**
 * Fragments de les series recurrents.
 */

import { html, raw } from "hono/html";

import type { Cadence } from "../../db/schema/index.ts";
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
    ${
      series.length === 0
        ? html`<p class="buit text-suau">
          Encara no s'ha detectat cap serie. Calen com a minim tres aparicions a
          intervals regulars perque una despesa es reconegui com a rebut.
        </p>`
        : html`<div class="desplaçable">
          <table class="dades">
            <thead>
              <tr>
                <th>Serie</th>
                <th>Cadencia</th>
                <th class="dreta">Import</th>
                <th class="dreta">Al mes</th>
                <th>Seguent</th>
                <th class="dreta">Confiança</th>
                <th>A la previsio</th>
              </tr>
            </thead>
            <tbody>
              ${series.map((serie) => Fila({ codi, serie, potEditar }))}
            </tbody>
          </table>
        </div>`
    }
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
        serie.isDeclared
          ? html`<span class="etiqueta" title="Marcat a ma des de Comerços">declarat</span>`
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
    <label class="casella">
      <input
        type="checkbox"
        name="nomes_subscripcions"
        value="1"
        ${filters.nomes_subscripcions ? raw("checked") : ""}
      />
      <span>Nomes les subscripcions</span>
    </label>
    <label class="casella">
      <input
        type="checkbox"
        name="inclou_acabades"
        value="1"
        ${filters.inclou_acabades ? raw("checked") : ""}
      />
      <span>Inclou les acabades</span>
    </label>
  </form>` as Html;
}
