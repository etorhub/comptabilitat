/**
 * Fragments of the recurring series (schedules).
 */

import { html, raw } from "hono/html";

import type { AmountMode, Cadence } from "../../db/schema/index.ts";
import { Field, Checkbox, Select, type FieldErrors } from "../../components/form.ts";
import { DataTable } from "../../components/views.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate, todayLocal } from "../../lib/time.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { OccurrenceView, SeriesView } from "../../services/recurring-list.ts";
import type { CreateSeriesInput, RecurringFilters } from "./recurring.schema.ts";
import { oobAttributes, type OobId } from "../../lib/oob.ts";

const CADENCES: Record<Cadence, string> = {
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

const dateShort = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

const iconPencil = html`<svg
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
  code: string;
  series: SeriesView[];
  canEdit: boolean;
  /** Id of the HTMX container (suggestions vs active). */
  containerId: OobId;
  empty: Html | string;
  /** If true, shows the confirm/dismiss form. */
  areProposals?: boolean;
}

export function Table({
  code,
  series,
  canEdit,
  containerId,
  empty,
  areProposals = false,
  oob = false,
}: TableProps & { oob?: boolean }): Html {
  return html`<div ${oobAttributes(containerId, oob)}>
    ${DataTable({
      columns: areProposals
        ? (html`<th>Proposta</th>
            <th>Cadencia</th>
            <th class="dreta">Import</th>
            <th>Seguent</th>
            <th class="dreta">Confiança</th>
            ${canEdit ? html`<th></th>` : ""}` as Html)
        : (html`<th>Serie</th>
            <th>Cadencia</th>
            <th class="dreta">Import</th>
            <th class="dreta">Al mes</th>
            <th>Seguent</th>
            <th>A la previsio</th>
            <th></th>` as Html),
      rows: series.map((item) =>
        areProposals
          ? ProposalRow({ code, series: item, canEdit })
          : ActiveRow({ code, series: item, canEdit }),
      ),
      empty,
    })}
  </div>` as Html;
}

export function ProposalRow({
  code,
  series,
  canEdit,
}: {
  code: string;
  series: SeriesView;
  canEdit: boolean;
}): Html {
  const base = `/e/${code}/recurrents/${series.id}`;

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
    <td>${CADENCES[series.cadence]}</td>
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
      canEdit
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
              value: series.cadence,
              options: (Object.keys(CADENCES) as Cadence[]).map((c) => ({
                value: c,
                text: CADENCES[c],
              })),
            })}
            ${Select({
              name: "amount_mode",
              tag: "Import",
              value: "exact",
              options: (Object.keys(MODES) as AmountMode[]).map((m) => ({
                value: m,
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
  code,
  series,
  canEdit,
  editing = false,
  occurrences = null,
}: {
  code: string;
  series: SeriesView;
  canEdit: boolean;
  /** Edit mode: amount + Dismiss. */
  editing?: boolean;
  /** If not null, the real linked transactions are shown. */
  occurrences?: OccurrenceView[] | null;
}): Html {
  const base = `/e/${code}/recurrents/${series.id}`;
  const absoluteAmount = money(series.expectedAmount).abs().toFixed(2);
  const showing = occurrences !== null;

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
        showing
          ? html`<ul class="llista-aparicions">
            ${
              occurrences.length === 0
                ? html`<li class="text-suau">Encara no hi ha cap moviment enllaçat.</li>`
                : occurrences.map(
                    (a) =>
                      html`<li>
                        <time datetime="${a.bookingDate}">
                          ${dateShort.format(new Date(`${a.bookingDate}T00:00:00`))}
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
    <td>${CADENCES[series.cadence]}</td>
    <td class="dreta">
      ${
        canEdit && editing && series.status === "active"
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
                value="${absoluteAmount}"
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
        canEdit && series.status === "active"
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
        code,
        series,
        canEdit,
        editing,
        showing,
      })}
    </td>
  </tr>` as Html;
}

function SeriesActions({
  code,
  series,
  canEdit,
  editing,
  showing,
}: {
  code: string;
  series: SeriesView;
  canEdit: boolean;
  editing: boolean;
  showing: boolean;
}): Html {
  const base = `/e/${code}/recurrents/${series.id}`;
  const buttonShow = html`<button
    type="button"
    class="boto-icona"
    aria-label="${showing ? "Amaga" : "Mostra"} els moviments de ${series.label}"
    title="${showing ? "Amaga els moviments" : "Mostra els moviments"}"
    hx-get="${base}/fragment/fila${showing ? "" : "?mostra=1"}"
    hx-target="#serie-${series.id}"
    hx-swap="outerHTML"
  >
    ${iconUll}
  </button>`;

  if (canEdit && series.status === "active" && editing) {
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

  if (canEdit && series.status === "active") {
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
        ${iconPencil}
      </button>
      ${buttonShow}
    </div>` as Html;
  }

  return html`<div class="fila-accions">${buttonShow}</div>` as Html;
}

export interface FilterBarProps {
  code: string;
  filters: RecurringFilters;
}

export function FilterBar({ code, filters }: FilterBarProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${code}/recurrents/fragment/actives"
    hx-target="#taula-recurrents-actives"
    hx-swap="outerHTML"
    hx-push-url="false"
  >
    ${Checkbox({
      name: "inclou_acabades",
      tag: "Inclou les acabades",
      marked: filters.inclou_acabades,
      value: "1",
      attributes: 'onchange="this.form.requestSubmit()"',
    })}
  </form>` as Html;
}

export interface CreateFormProps {
  code: string;
  groups: CategoryGroup[];
  values?: Partial<CreateSeriesInput> & { amount?: string };
  errors?: FieldErrors;
}

/** Form for adding an active series by hand. */
export function CreateForm({ code, groups, values = {}, errors }: CreateFormProps): Html {
  return html`<form
    id="form-recurrent-nou"
    class="filtres"
    hx-post="/e/${code}/recurrents"
    hx-target="#form-recurrent-nou"
    hx-swap="outerHTML"
  >
    ${Field({
      name: "label",
      tag: "Nom",
      value: values.label ?? "",
      errors,
      required: true,
      maxlength: 200,
    })}
    ${Select({
      name: "category_id",
      tag: "Categoria",
      value: values.category_id ?? "",
      groups: groups.map((g) => ({
        tag: g.tag,
        options: g.options.map((o) => ({ value: o.value, text: o.text })),
      })),
      empty: "Tria’n una",
      errors,
    })}
    ${Select({
      name: "cadence",
      tag: "Cadencia",
      value: values.cadence ?? "monthly",
      options: (Object.keys(CADENCES) as Cadence[]).map((c) => ({
        value: c,
        text: CADENCES[c],
      })),
      errors,
    })}
    ${Field({
      name: "amount",
      tag: "Import",
      value: values.amount ?? "",
      errors,
      required: true,
      step: "0.01",
      placeholder: "12.99",
    })}
    ${Select({
      name: "sentit",
      tag: "Sentit",
      value: values.sentit ?? "out",
      options: [
        { value: "out", text: "Despesa" },
        { value: "in", text: "Ingres" },
      ],
      errors,
    })}
    ${Field({
      name: "next_expected_date",
      tag: "Proxima data",
      type: "date",
      value: values.next_expected_date ?? todayLocal(),
      errors,
      required: true,
    })}
    <button type="submit" class="boto boto-primari">Afegeix</button>
  </form>` as Html;
}
