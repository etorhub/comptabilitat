/**
 * Fragments de les series recurrents (schedules).
 */

import { html, raw } from "hono/html";

import type { AmountMode, Cadence } from "../../db/schema/index.ts";
import { Camp, Casella, Tria, type FieldErrors } from "../../components/form.ts";
import { TaulaDades } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate, todayLocal } from "../../lib/time.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { AparicioVista, SerieVista } from "../../services/recurring-list.ts";
import type { CreaSerieInput, RecurringFilters } from "./recurring.schema.ts";
import { atributsOob, type IdOob } from "../../lib/oob.ts";

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

const dataCurta = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

const iconaLlapis = html`<svg
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

const iconaUll = html`<svg
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

export interface TaulaProps {
  codi: string;
  series: SerieVista[];
  potEditar: boolean;
  /** Id del contenidor HTMX (suggestions vs actives). */
  idContenidor: IdOob;
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
  return html`<div ${atributsOob(idContenidor, oob)}>
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
            <th></th>` as Html),
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
  editant = false,
  aparicions = null,
}: {
  codi: string;
  serie: SerieVista;
  potEditar: boolean;
  /** Mode edicio: import + Descarta. */
  editant?: boolean;
  /** Si no es null, es mostren els moviments reals enllaçats. */
  aparicions?: AparicioVista[] | null;
}): Html {
  const base = `/e/${codi}/recurrents/${serie.id}`;
  const importAbsolut = money(serie.expectedAmount).abs().toFixed(2);
  const mostrant = aparicions !== null;

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
      ${
        mostrant
          ? html`<ul class="llista-aparicions">
            ${
              aparicions.length === 0
                ? html`<li class="text-suau">Encara no hi ha cap moviment enllaçat.</li>`
                : aparicions.map(
                    (a) =>
                      html`<li>
                        <time datetime="${a.bookingDate}">
                          ${dataCurta.format(new Date(`${a.bookingDate}T00:00:00`))}
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
    <td>${CADENCIES[serie.cadence]}</td>
    <td class="dreta">
      ${
        potEditar && editant && serie.status === "active"
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
    <td>
      ${AccionsSerie({
        codi,
        serie,
        potEditar,
        editant,
        mostrant,
      })}
    </td>
  </tr>` as Html;
}

function AccionsSerie({
  codi,
  serie,
  potEditar,
  editant,
  mostrant,
}: {
  codi: string;
  serie: SerieVista;
  potEditar: boolean;
  editant: boolean;
  mostrant: boolean;
}): Html {
  const base = `/e/${codi}/recurrents/${serie.id}`;
  const botoMostra = html`<button
    type="button"
    class="boto-icona"
    aria-label="${mostrant ? "Amaga" : "Mostra"} els moviments de ${serie.label}"
    title="${mostrant ? "Amaga els moviments" : "Mostra els moviments"}"
    hx-get="${base}/fragment/fila${mostrant ? "" : "?mostra=1"}"
    hx-target="#serie-${serie.id}"
    hx-swap="outerHTML"
  >
    ${iconaUll}
  </button>`;

  if (potEditar && serie.status === "active" && editant) {
    return html`<div class="fila-accions">
      <button
        type="button"
        class="boto"
        hx-post="${base}/descarta"
        hx-target="#serie-${serie.id}"
        hx-swap="outerHTML"
        hx-confirm="Vols descartar «${serie.label}»? El detector ja no la tornara a proposar."
      >
        Descarta
      </button>
      <button
        type="button"
        class="boto boto-discret"
        hx-get="${base}/fragment/fila"
        hx-target="#serie-${serie.id}"
        hx-swap="outerHTML"
      >
        Cancel·la
      </button>
    </div>` as Html;
  }

  if (potEditar && serie.status === "active") {
    return html`<div class="fila-accions">
      <button
        type="button"
        class="boto-icona"
        aria-label="Edita ${serie.label}"
        title="Edita"
        hx-get="${base}/fragment/fila?editant=1"
        hx-target="#serie-${serie.id}"
        hx-swap="outerHTML"
      >
        ${iconaLlapis}
      </button>
      ${botoMostra}
    </div>` as Html;
  }

  return html`<div class="fila-accions">${botoMostra}</div>` as Html;
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
