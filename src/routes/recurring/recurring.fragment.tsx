/**
 * Fragments de les series recurrents (schedules).
 */

import { html, raw } from "hono/html";

import type { AmountMode, Cadence } from "../../db/schema/index.ts";
import { Camp, Casella, Tria, type FieldErrors } from "../../components/form.tsx";
import { TaulaDades } from "../../components/vista.tsx";
import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate, todayLocal } from "../../lib/time.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { SerieVista } from "../../services/recurring-list.ts";
import type { CreaSerieInput, RecurringFilters } from "./recurring.schema.ts";

const CADENCIES: Record<Cadence, string> = {
  weekly: "setmanal",
  biweekly: "quinzenal",
  monthly: "mensual",
  bimonthly: "bimensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
};

const MODES: Record<AmountMode, string> = {
  exact: "import fix",
  average: "mitjana recent",
};

export interface TaulaProps {
  codi: string;
  series: SerieVista[];
  potEditar: boolean;
  /** Id del contenidor HTMX (suggestions vs actives). */
  idContenidor: string;
  buit: Html | string;
  /** Si true, mostra el formulari de confirmar/descartar. */
  sonPropostes?: boolean;
}

export function Taula({
  codi,
  series,
  potEditar,
  idContenidor,
  buit,
  sonPropostes = false,
  oob = false,
}: TaulaProps & { oob?: boolean }): Html {
  return html`<div id="${idContenidor}" ${oob ? raw('hx-swap-oob="true"') : ""}>
    ${TaulaDades({
      columnes: sonPropostes
        ? (html`<th>Proposta</th>
            <th>Cadencia</th>
            <th class="dreta">Import</th>
            <th>Seguent</th>
            <th class="dreta">Confiança</th>
            ${potEditar ? html`<th></th>` : ""}` as Html)
        : (html`<th>Serie</th>
            <th>Cadencia</th>
            <th class="dreta">Import</th>
            <th class="dreta">Al mes</th>
            <th>Seguent</th>
            <th>A la previsio</th>
            ${potEditar ? html`<th></th>` : ""}` as Html),
      files: series.map((serie) =>
        sonPropostes
          ? FilaProposta({ codi, serie, potEditar })
          : FilaActiva({ codi, serie, potEditar }),
      ),
      buit,
    })}
  </div>` as Html;
}

export function FilaProposta({
  codi,
  serie,
  potEditar,
}: {
  codi: string;
  serie: SerieVista;
  potEditar: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${serie.id}`;

  return html`<tr id="serie-${serie.id}">
    <td>
      <span class="nom">${serie.label}</span>
      ${
        serie.categoryName
          ? html`<br /><small class="text-suau">${serie.categoryName}</small>`
          : ""
      }
      <br /><small class="text-suau">${String(serie.occurrencesCount)} aparicions</small>
    </td>
    <td>${CADENCIES[serie.cadence]}</td>
    <td class="dreta">${formatMoney(serie.expectedAmount)}</td>
    <td>
      ${
        serie.nextExpectedDate
          ? html`<time datetime="${serie.nextExpectedDate}">
            ${formatDate(serie.nextExpectedDate)}
          </time>`
          : html`<span class="text-suau">—</span>`
      }
    </td>
    <td class="dreta">${String(Math.round(serie.confidence * 100))}%</td>
    ${
      potEditar
        ? html`<td>
          <form
            class="fila-accions"
            hx-post="${base}/confirma"
            hx-target="#serie-${serie.id}"
            hx-swap="outerHTML"
          >
            ${Tria({
              nom: "cadence",
              etiqueta: "Cadencia",
              valor: serie.cadence,
              opcions: (Object.keys(CADENCIES) as Cadence[]).map((c) => ({
                valor: c,
                text: CADENCIES[c],
              })),
            })}
            ${Tria({
              nom: "amount_mode",
              etiqueta: "Import",
              valor: "exact",
              opcions: (Object.keys(MODES) as AmountMode[]).map((m) => ({
                valor: m,
                text: MODES[m],
              })),
            })}
            <button type="submit" class="boto boto-primari">Confirma</button>
            <button
              type="button"
              class="boto"
              hx-post="${base}/descarta"
              hx-target="#serie-${serie.id}"
              hx-swap="outerHTML"
            >
              Descarta
            </button>
          </form>
        </td>`
        : html`<td></td>`
    }
  </tr>` as Html;
}

export function FilaActiva({
  codi,
  serie,
  potEditar,
}: {
  codi: string;
  serie: SerieVista;
  potEditar: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${serie.id}`;
  const importAbsolut = money(serie.expectedAmount).abs().toFixed(2);

  return html`<tr id="serie-${serie.id}" class="${serie.status === "ended" ? "inactiva" : ""}">
    <td>
      <span class="nom">${serie.label}</span>
      <span class="etiqueta" title="Com s'estima l'import">${MODES[serie.amountMode]}</span>
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
    <td class="dreta">
      ${
        potEditar && serie.status === "active"
          ? html`<form
            class="fila-accions"
            hx-post="${base}/import"
            hx-target="#serie-${serie.id}"
            hx-swap="outerHTML"
          >
            <label class="camp camp-linia camp-estret">
              <span class="visualment-ocult">Import</span>
              <input
                type="text"
                name="amount"
                inputmode="decimal"
                value="${importAbsolut}"
                aria-label="Import de ${serie.label}"
              />
            </label>
            <button type="submit" class="boto">Desa</button>
          </form>`
          : formatMoney(serie.expectedAmount)
      }
    </td>
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
    <td>
      ${
        potEditar && serie.status === "active"
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
    ${
      potEditar
        ? html`<td>
          ${
            serie.status === "active"
              ? html`<button
                type="button"
                class="boto"
                hx-post="${base}/descarta"
                hx-target="#serie-${serie.id}"
                hx-swap="outerHTML"
                hx-confirm="Vols descartar «${serie.label}»? Ja no entrara a la previsio."
              >
                Descarta
              </button>`
              : ""
          }
        </td>`
        : ""
    }
  </tr>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: RecurringFilters;
}

export function BarraFiltres({ codi, filters }: BarraFiltresProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${codi}/recurrents/fragment/actives"
    hx-target="#taula-recurrents-actives"
    hx-swap="outerHTML"
    hx-push-url="false"
  >
    ${Casella({
      nom: "inclou_acabades",
      etiqueta: "Inclou les acabades",
      marcat: filters.inclou_acabades,
      valor: "1",
      atributs: 'onchange="this.form.requestSubmit()"',
    })}
  </form>` as Html;
}

export interface FormAltaProps {
  codi: string;
  grups: GrupCategories[];
  valors?: Partial<CreaSerieInput> & { amount?: string };
  errors?: FieldErrors;
}

/** Formulari per afegir una serie activa a ma. */
export function FormAlta({ codi, grups, valors = {}, errors }: FormAltaProps): Html {
  return html`<form
    id="form-recurrent-nou"
    class="filtres"
    hx-post="/e/${codi}/recurrents"
    hx-target="#form-recurrent-nou"
    hx-swap="outerHTML"
  >
    ${Camp({
      nom: "label",
      etiqueta: "Nom",
      valor: valors.label ?? "",
      errors,
      requerit: true,
      maxlength: 200,
    })}
    ${Tria({
      nom: "category_id",
      etiqueta: "Categoria",
      valor: valors.category_id ?? "",
      grups: grups.map((g) => ({
        etiqueta: g.etiqueta,
        opcions: g.opcions.map((o) => ({ valor: o.valor, text: o.text })),
      })),
      buit: "Tria’n una",
      errors,
    })}
    ${Tria({
      nom: "cadence",
      etiqueta: "Cadencia",
      valor: valors.cadence ?? "monthly",
      opcions: (Object.keys(CADENCIES) as Cadence[]).map((c) => ({
        valor: c,
        text: CADENCIES[c],
      })),
      errors,
    })}
    ${Camp({
      nom: "amount",
      etiqueta: "Import",
      valor: valors.amount ?? "",
      errors,
      requerit: true,
      step: "0.01",
      placeholder: "12.99",
    })}
    ${Tria({
      nom: "sentit",
      etiqueta: "Sentit",
      valor: valors.sentit ?? "out",
      opcions: [
        { valor: "out", text: "Despesa" },
        { valor: "in", text: "Ingres" },
      ],
      errors,
    })}
    ${Camp({
      nom: "next_expected_date",
      etiqueta: "Proxima data",
      tipus: "date",
      valor: valors.next_expected_date ?? todayLocal(),
      errors,
      requerit: true,
    })}
    <button type="submit" class="boto boto-primari">Afegeix</button>
  </form>` as Html;
}
