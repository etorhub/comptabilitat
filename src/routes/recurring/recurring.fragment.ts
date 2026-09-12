/**
 * Fragments de les series recurrents (schedules).
 */

import { html, raw } from "hono/html";

import type { AmountMode, Cadence } from "../../db/schema/index.ts";
import { Field, Checkbox, Select, type FieldErrors } from "../../components/form.ts";
import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate, todayLocal } from "../../lib/time.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { OccurrenceView, SeriesView } from "../../services/recurring-list.ts";
import type { CreateSeriesInput, RecurringFilters } from "./recurring.schema.ts";
import { oobAttributes, type OobId } from "../../lib/oob.ts";

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

const dateCurta = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

const iconLlapis = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 20h9" />
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
</svg>`;

const iconUll = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
  <circle cx="12" cy="12" r="3" />
</svg>`;

export interface TableProps {
  codi: string;
  series: SeriesView[];
  potEditar: boolean;
  /** Id del contenidor HTMX (suggestions vs actives). */
  idContenidor: OobId;
  empty: Html | string;
  /** Si true, mostra el formulari de confirmar/descartar. */
  sonPropostes?: boolean;
}

export function Table({
  codi,
  series,
  potEditar,
  idContenidor,
  empty,
  sonPropostes = false,
  oob = false,
}: TableProps & { oob?: boolean }): Html {
  return html`<div ${oobAttributes(idContenidor, oob)}>
    ${DataTable({
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
            <th></th>` as Html),
      rows: series.map((item) =>
        sonPropostes
          ? ProposalRow({ codi, series: item, potEditar })
          : ActiveRow({ codi, series: item, potEditar }),
      ),
      empty,
    })}
  </div>` as Html;
}

export function ProposalRow({
  codi,
  series,
  potEditar,
}: {
  codi: string;
  series: SeriesView;
  potEditar: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${series.id}`;

  return html`<tr id="serie-${series.id}">
    <td>
      <span class="nom">${series.label}</span>
      ${
        series.categoryName
          ? html`<br /><small class="text-suau">${series.categoryName}</small>`
          : ""
      }
      <br /><small class="text-suau">${String(series.occurrencesCount)} aparicions</small>
    </td>
    <td>${CADENCIES[series.cadence]}</td>
    <td class="dreta">${formatMoney(series.expectedAmount)}</td>
    <td>
      ${
        series.nextExpectedDate
          ? html`<time datetime="${series.nextExpectedDate}">
            ${formatDate(series.nextExpectedDate)}
          </time>`
          : html`<span class="text-suau">—</span>`
      }
    </td>
    <td class="dreta">${String(Math.round(series.confidence * 100))}%</td>
    ${
      potEditar
        ? html`<td>
          <form
            class="fila-accions"
            hx-post="${base}/confirma"
            hx-target="#serie-${series.id}"
            hx-swap="outerHTML"
          >
            ${Select({
              name: "cadence",
              tag: "Cadencia",
              valor: series.cadence,
              options: (Object.keys(CADENCIES) as Cadence[]).map((c) => ({
                valor: c,
                text: CADENCIES[c],
              })),
            })}
            ${Select({
              name: "amount_mode",
              tag: "Import",
              valor: "exact",
              options: (Object.keys(MODES) as AmountMode[]).map((m) => ({
                valor: m,
                text: MODES[m],
              })),
            })}
            <button type="submit" class="boto boto-primari">Confirma</button>
            <button
              type="button"
              class="boto"
              hx-post="${base}/descarta"
              hx-target="#serie-${series.id}"
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

export function ActiveRow({
  codi,
  series,
  potEditar,
  editant = false,
  occurrences = null,
}: {
  codi: string;
  series: SeriesView;
  potEditar: boolean;
  /** Mode edicio: import + Descarta. */
  editant?: boolean;
  /** Si no es null, es mostren els moviments reals enllaçats. */
  occurrences?: OccurrenceView[] | null;
}): Html {
  const base = `/e/${codi}/recurrents/${series.id}`;
  const importAbsolut = money(series.expectedAmount).abs().toFixed(2);
  const mostrant = occurrences !== null;

  return html`<tr id="serie-${series.id}" class="${series.status === "ended" ? "inactiva" : ""}">
    <td>
      <span class="nom">${series.label}</span>
      <span class="etiqueta" title="Com s'estima l'import">${MODES[series.amountMode]}</span>
      ${
        series.status === "ended"
          ? html`<span class="etiqueta etiqueta-suau">acabada</span>`
          : ""
      }
      ${
        series.categoryName
          ? html`<br /><small class="text-suau">${series.categoryName}</small>`
          : ""
      }
      ${
        mostrant
          ? html`<ul class="llista-aparicions">
            ${
              occurrences.length === 0
                ? html`<li class="text-suau">Encara no hi ha cap moviment enllaçat.</li>`
                : occurrences.map(
                    (a) =>
                      html`<li>
                        <time datetime="${a.bookingDate}">
                          ${dateCurta.format(new Date(`${a.bookingDate}T00:00:00`))}
                        </time>
                        <span>${a.description}</span>
                        <span class="dreta">${formatMoney(a.amount)}</span>
                      </li>`,
                  )
            }
          </ul>`
          : ""
      }
    </td>
    <td>${CADENCIES[series.cadence]}</td>
    <td class="dreta">
      ${
        potEditar && editant && series.status === "active"
          ? html`<form
            class="fila-accions"
            hx-post="${base}/import"
            hx-target="#serie-${series.id}"
            hx-swap="outerHTML"
          >
            <label class="camp camp-linia camp-estret">
              <span class="visualment-ocult">Import</span>
              <input
                type="text"
                name="amount"
                inputmode="decimal"
                value="${importAbsolut}"
                aria-label="Import de ${series.label}"
              />
            </label>
            <button type="submit" class="boto">Desa</button>
          </form>`
          : formatMoney(series.expectedAmount)
      }
    </td>
    <td class="dreta">${formatMoney(series.monthlyCost)}</td>
    <td>
      ${
        series.nextExpectedDate
          ? html`<time datetime="${series.nextExpectedDate}">
            ${formatDate(series.nextExpectedDate)}
          </time>`
          : html`<span class="text-suau">—</span>`
      }
    </td>
    <td>
      ${
        potEditar && series.status === "active"
          ? html`<input
            type="checkbox"
            name="include_in_forecast"
            ${series.includeInForecast ? raw("checked") : ""}
            aria-label="Inclou ${series.label} a la previsio"
            hx-post="${base}/previsio"
            hx-target="#serie-${series.id}"
            hx-swap="outerHTML"
          />`
          : series.includeInForecast
            ? "Si"
            : "No"
      }
    </td>
    <td>
      ${SeriesActions({
        codi,
        series,
        potEditar,
        editant,
        mostrant,
      })}
    </td>
  </tr>` as Html;
}

function SeriesActions({
  codi,
  series,
  potEditar,
  editant,
  mostrant,
}: {
  codi: string;
  series: SeriesView;
  potEditar: boolean;
  editant: boolean;
  mostrant: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${series.id}`;
  const buttonShow = html`<button
    type="button"
    class="boto-icona"
    aria-label="${mostrant ? "Amaga" : "Mostra"} els moviments de ${series.label}"
    title="${mostrant ? "Amaga els moviments" : "Mostra els moviments"}"
    hx-get="${base}/fragment/fila${mostrant ? "" : "?mostra=1"}"
    hx-target="#serie-${series.id}"
    hx-swap="outerHTML"
  >
    ${iconUll}
  </button>`;

  if (potEditar && series.status === "active" && editant) {
    return html`<div class="fila-accions">
      <button
        type="button"
        class="boto"
        hx-post="${base}/descarta"
        hx-target="#serie-${series.id}"
        hx-swap="outerHTML"
        hx-confirm="Vols descartar «${series.label}»? El detector ja no la tornara a proposar."
      >
        Descarta
      </button>
      <button
        type="button"
        class="boto boto-discret"
        hx-get="${base}/fragment/fila"
        hx-target="#serie-${series.id}"
        hx-swap="outerHTML"
      >
        Cancel·la
      </button>
    </div>` as Html;
  }

  if (potEditar && series.status === "active") {
    return html`<div class="fila-accions">
      <button
        type="button"
        class="boto-icona"
        aria-label="Edita ${series.label}"
        title="Edita"
        hx-get="${base}/fragment/fila?editant=1"
        hx-target="#serie-${series.id}"
        hx-swap="outerHTML"
      >
        ${iconLlapis}
      </button>
      ${buttonShow}
    </div>` as Html;
  }

  return html`<div class="fila-accions">${buttonShow}</div>` as Html;
}

export interface FilterBarProps {
  codi: string;
  filters: RecurringFilters;
}

export function FilterBar({ codi, filters }: FilterBarProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${codi}/recurrents/fragment/actives"
    hx-target="#taula-recurrents-actives"
    hx-swap="outerHTML"
    hx-push-url="false"
  >
    ${Checkbox({
      name: "inclou_acabades",
      tag: "Inclou les acabades",
      marcat: filters.inclou_acabades,
      valor: "1",
      attributes: 'onchange="this.form.requestSubmit()"',
    })}
  </form>` as Html;
}

export interface CreateFormProps {
  codi: string;
  groups: CategoryGroup[];
  valors?: Partial<CreateSeriesInput> & { amount?: string };
  errors?: FieldErrors;
}

/** Formulari per afegir una serie activa a ma. */
export function CreateForm({ codi, groups, valors = {}, errors }: CreateFormProps): Html {
  return html`<form
    id="form-recurrent-nou"
    class="filtres"
    hx-post="/e/${codi}/recurrents"
    hx-target="#form-recurrent-nou"
    hx-swap="outerHTML"
  >
    ${Field({
      name: "label",
      tag: "Nom",
      valor: valors.label ?? "",
      errors,
      requerit: true,
      maxlength: 200,
    })}
    ${Select({
      name: "category_id",
      tag: "Categoria",
      valor: valors.category_id ?? "",
      groups: groups.map((g) => ({
        tag: g.tag,
        options: g.options.map((o) => ({ valor: o.valor, text: o.text })),
      })),
      empty: "Tria’n una",
      errors,
    })}
    ${Select({
      name: "cadence",
      tag: "Cadencia",
      valor: valors.cadence ?? "monthly",
      options: (Object.keys(CADENCIES) as Cadence[]).map((c) => ({
        valor: c,
        text: CADENCIES[c],
      })),
      errors,
    })}
    ${Field({
      name: "amount",
      tag: "Import",
      valor: valors.amount ?? "",
      errors,
      requerit: true,
      step: "0.01",
      placeholder: "12.99",
    })}
    ${Select({
      name: "sentit",
      tag: "Sentit",
      valor: valors.sentit ?? "out",
      options: [
        { valor: "out", text: "Despesa" },
        { valor: "in", text: "Ingres" },
      ],
      errors,
    })}
    ${Field({
      name: "next_expected_date",
      tag: "Proxima data",
      type: "date",
      valor: valors.next_expected_date ?? todayLocal(),
      errors,
      requerit: true,
    })}
    <button type="submit" class="boto boto-primari">Afegeix</button>
  </form>` as Html;
}
