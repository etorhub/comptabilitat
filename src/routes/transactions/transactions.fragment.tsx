/**
 * Fragments dels moviments.
 *
 * Cap plantilla d'aqui no toca mai una fila crua: nomes reben `MovimentVista`,
 * que ja ha passat per l'emmascarament. Vegeu `services/transactions.ts`.
 */

import { html, raw } from "hono/html";

import { Tria } from "../../components/form.tsx";
import type { CategorySource } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type {
  ItemRevisio,
  MovimentVista,
  PaginaMoviments,
} from "../../services/transactions.ts";
import { PER_PAGINA, type TransactionFilters } from "./transactions.schema.ts";

/** D'on ha sortit la categoria, en català. */
const ORIGEN: Record<CategorySource, { text: string; titol: string }> = {
  none: { text: "sense classificar", titol: "Encara no te categoria" },
  merchant: { text: "comerç", titol: "De la memoria de comerços d'aquest espai" },
  rule: { text: "regla", titol: "L'ha posat una regla" },
  llm: { text: "model", titol: "Ho proposa el model local; cal confirmar-ho" },
  user: { text: "tu", titol: "Ho has decidit tu. No ho canviara res." },
};

const dataCurta = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

export interface TaulaProps {
  codi: string;
  pagina: PaginaMoviments;
  grups: GrupCategories[];
  filters: TransactionFilters;
  potEditar: boolean;
}

export function Taula({ codi, pagina, grups, filters, potEditar }: TaulaProps): Html {
  const desde = pagina.total === 0 ? 0 : pagina.offset + 1;
  const fins = Math.min(pagina.offset + pagina.limit, pagina.total);

  return html`<div id="taula-moviments">
    ${pagina.items.length === 0
      ? html`<p class="buit text-suau">Cap moviment encaixa amb aquests filtres.</p>`
      : html`
          <form
            id="form-bloc"
            hx-post="/e/${codi}/moviments/bloc"
            hx-target="#taula-moviments"
            hx-swap="outerHTML"
          >
            ${potEditar ? BarraBloc({ grups }) : ""}

            <div class="desplaçable">
              <table class="dades taula-moviments">
                <thead>
                  <tr>
                    ${potEditar ? html`<th class="tria"><span class="visualment-ocult">Tria</span></th>` : ""}
                    <th>Data</th>
                    <th>Concepte</th>
                    <th>Comerç</th>
                    <th>Categoria</th>
                    <th class="dreta">Import</th>
                  </tr>
                </thead>
                <tbody>
                  ${pagina.items.map((moviment) =>
                    Fila({ codi, moviment, grups, potEditar }),
                  )}
                </tbody>
              </table>
            </div>
          </form>

          <nav class="paginacio" aria-label="Paginacio">
            <span class="text-suau">
              ${String(desde)}–${String(fins)} de ${String(pagina.total)} ·
              suma ${formatMoney(pagina.totalImport)}
            </span>
            ${Passos({ codi, filters, total: pagina.total })}
          </nav>
        `}
  </div>` as Html;
}

/**
 * La barra de la seleccio en bloc.
 *
 * A l'aplicacio de React la seleccio era una llista a la memoria del
 * navegador, i sobrevivia als canvis de filtre i de pagina: es podien marcar
 * files, paginar i aplicar la categoria a moviments que ja no es veien. Aqui
 * la seleccio son les caselles del formulari i prou, de manera que el que
 * s'aplica es sempre el que es veu.
 */
function BarraBloc({ grups }: { grups: GrupCategories[] }): Html {
  return html`<div class="barra-bloc">
    <label class="casella">
      <input
        type="checkbox"
        aria-label="Tria'ls tots"
        onclick="var f=this.closest('form');f.querySelectorAll('input[name=moviment]').forEach(function(c){c.checked=this.checked}.bind(this))"
      />
      <span>Tria'ls tots</span>
    </label>

    ${Tria({
      nom: "category_id",
      etiqueta: "Posa'ls la categoria",
      grups,
      buit: "— tria una categoria —",
    })}

    <button type="submit" class="boto">Aplica-la als triats</button>
  </div>` as Html;
}

function Passos({
  codi,
  filters,
  total,
}: {
  codi: string;
  filters: TransactionFilters;
  total: number;
}): Html {
  const ultima = Math.max(0, Math.ceil(total / PER_PAGINA) - 1);
  const enllac = (p: number) => {
    const params = new URLSearchParams();
    if (filters.cerca) params.set("cerca", filters.cerca);
    if (filters.des) params.set("des", filters.des);
    if (filters.fins) params.set("fins", filters.fins);
    if (filters.compte !== null) params.set("compte", String(filters.compte));
    if (filters.categoria !== null) params.set("categoria", String(filters.categoria));
    if (filters.sense_classificar) params.set("sense_classificar", "1");
    if (filters.revisio) params.set("revisio", "1");
    if (filters.traspassos) params.set("traspassos", "1");
    if (p > 0) params.set("pagina", String(p));
    return `/e/${codi}/moviments/fragment/taula?${params.toString()}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina - 1)}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= ultima ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina + 1)}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}

export interface FilaProps {
  codi: string;
  moviment: MovimentVista;
  grups: GrupCategories[];
  potEditar: boolean;
}

export function Fila({ codi, moviment, grups, potEditar }: FilaProps): Html {
  const base = `/e/${codi}/moviments/${moviment.id}`;
  const origen = ORIGEN[moviment.categorySource];
  const negatiu = moviment.amount.startsWith("-");

  return html`<tr id="moviment-${moviment.id}" class="${moviment.isExcluded ? "exclos" : ""}">
    ${potEditar
      ? html`<td class="tria">
          <input
            type="checkbox"
            name="moviment"
            value="${moviment.id}"
            aria-label="Tria el moviment de ${moviment.description}"
          />
        </td>`
      : ""}

    <td class="data">
      <time datetime="${moviment.bookingDate}">
        ${dataCurta.format(new Date(`${moviment.bookingDate}T00:00:00`))}
      </time>
      ${moviment.status === "pending"
        ? html`<span class="etiqueta etiqueta-suau" title="Encara no es definitiu">pendent</span>`
        : ""}
    </td>

    <td>
      ${potEditar
        ? html`<button
            type="button"
            class="concepte"
            title="Canvia com es veu aquest concepte"
            hx-get="${base}/fragment/concepte"
            hx-target="#moviment-${moviment.id}"
            hx-swap="outerHTML"
          >
            ${moviment.description}
          </button>`
        : html`<span>${moviment.description}</span>`}
      ${moviment.isMasked
        ? html`<span class="etiqueta etiqueta-suau" title="El concepte del banc esta amagat"
            >alies</span
          >`
        : ""}
      ${moviment.transferGroupId
        ? html`<span class="etiqueta etiqueta-suau" title="Traspas entre comptes propis"
            >traspas</span
          >`
        : ""}
      ${moviment.notes ? html`<small class="text-suau nota">${moviment.notes}</small>` : ""}
    </td>

    <td>
      ${moviment.merchantName ?? html`<span class="text-suau">—</span>`}
    </td>

    <td>
      ${potEditar
        ? Tria({
            nom: "category_id",
            etiqueta: `Categoria de ${moviment.description}`,
            valor: moviment.categoryId,
            grups,
            buit: "— sense classificar —",
            atributs: `hx-post="${base}/categoria" hx-target="#moviment-${moviment.id}" hx-swap="outerHTML" hx-trigger="change"`,
          })
        : (moviment.categoryName ?? html`<span class="text-suau">—</span>`)}
      <span class="origen etiqueta etiqueta-suau" title="${origen.titol}">${origen.text}</span>
      ${moviment.needsReview
        ? html`<span class="etiqueta" title="Cal que algu ho confirmi">per revisar</span>`
        : ""}
    </td>

    <td class="dreta ${negatiu ? "negatiu" : "positiu"}">${formatMoney(moviment.amount)}</td>
  </tr>` as Html;
}

/** La fila convertida en un camp per posar-hi un alias. */
export function FilaConcepte({
  codi,
  moviment,
}: {
  codi: string;
  moviment: MovimentVista;
}): Html {
  return html`<tr id="moviment-${moviment.id}" class="editant">
    <td colspan="6">
      <form
        class="linia"
        hx-post="/e/${codi}/moviments/${moviment.id}/concepte"
        hx-target="#moviment-${moviment.id}"
        hx-swap="outerHTML"
      >
        <label class="camp camp-linia">
          <span class="camp-etiqueta">Com vols que es vegi</span>
          <input
            type="text"
            name="display_description"
            value="${moviment.isMasked ? moviment.description : ""}"
            maxlength="200"
            placeholder="${moviment.description}"
            autofocus
          />
          <small class="camp-ajuda">
            Si hi poses un text, amaga el concepte del banc i el comerç, i el
            moviment deixa de trobar-se cercant-los. Deixa-ho buit per tornar-ho
            a ensenyar.
          </small>
        </label>
        <button type="submit" class="boto">Desa</button>
        <button
          type="button"
          class="boto boto-discret"
          hx-get="/e/${codi}/moviments/${moviment.id}/fragment/fila"
          hx-target="#moviment-${moviment.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: TransactionFilters;
  comptes: { valor: number; text: string }[];
  grups: GrupCategories[];
}

export function BarraFiltres({ codi, filters, comptes, grups }: BarraFiltresProps): Html {
  return html`<form
    class="filtres superficie targeta"
    hx-get="/e/${codi}/moviments/fragment/taula"
    hx-target="#taula-moviments"
    hx-swap="outerHTML"
    hx-trigger="change, keyup changed delay:300ms from:input[name='cerca']"
  >
    <label class="camp camp-linia">
      <span class="camp-etiqueta">Cerca</span>
      <input
        type="search"
        name="cerca"
        value="${filters.cerca}"
        placeholder="Concepte, comerç o nota"
        autocomplete="off"
      />
    </label>

    <label class="camp camp-linia camp-estret">
      <span class="camp-etiqueta">Des de</span>
      <input type="date" name="des" value="${filters.des ?? ""}" />
    </label>

    <label class="camp camp-linia camp-estret">
      <span class="camp-etiqueta">Fins a</span>
      <input type="date" name="fins" value="${filters.fins ?? ""}" />
    </label>

    ${comptes.length > 1
      ? Tria({
          nom: "compte",
          etiqueta: "Compte",
          valor: filters.compte,
          opcions: comptes,
          buit: "— tots —",
        })
      : ""}

    ${Tria({
      nom: "categoria",
      etiqueta: "Categoria",
      valor: filters.categoria,
      grups,
      buit: "— totes —",
    })}

    <label class="casella">
      <input
        type="checkbox"
        name="sense_classificar"
        value="1"
        ${filters.sense_classificar ? raw("checked") : ""}
      />
      <span>Nomes sense classificar</span>
    </label>

    <label class="casella">
      <input type="checkbox" name="revisio" value="1" ${filters.revisio ? raw("checked") : ""} />
      <span>Nomes per revisar</span>
    </label>

    <label class="casella">
      <input
        type="checkbox"
        name="traspassos"
        value="1"
        ${filters.traspassos ? raw("checked") : ""}
      />
      <span>Inclou els traspassos</span>
    </label>
  </form>` as Html;
}

// --- Safata de revisio -------------------------------------------------------


export interface CuaRevisioProps {
  codi: string;
  items: ItemRevisio[];
  grups: GrupCategories[];
  total: number;
}

export function CuaRevisio({ codi, items, grups, total }: CuaRevisioProps): Html {
  return html`<div id="cua-revisio">
    ${items.length === 0
      ? html`<p class="buit text-suau">
          No hi ha res per revisar. Tot te categoria.
        </p>`
      : html`
          <p class="text-suau">
            ${String(total)} ${total === 1 ? "moviment espera" : "moviments esperen"} que algu
            en confirmi la categoria.
          </p>
          <ul class="revisio">
            ${items.map((item) => TargetaRevisio({ codi, item, grups }))}
          </ul>
        `}
  </div>` as Html;
}

export function TargetaRevisio({
  codi,
  item,
  grups,
}: {
  codi: string;
  item: ItemRevisio;
  grups: GrupCategories[];
}): Html {
  const { moviment } = item;
  const negatiu = moviment.amount.startsWith("-");

  return html`<li id="revisio-${moviment.id}" class="superficie targeta item-revisio">
    <div class="item-cap">
      <time datetime="${moviment.bookingDate}" class="text-suau">
        ${dataCurta.format(new Date(`${moviment.bookingDate}T00:00:00`))}
      </time>
      <strong>${moviment.description}</strong>
      <span class="${negatiu ? "negatiu" : "positiu"}">${formatMoney(moviment.amount)}</span>
    </div>

    ${moviment.merchantName
      ? html`<p class="text-suau">${moviment.merchantName}</p>`
      : ""}

    ${item.suggestedCategoryName
      ? html`<p class="proposta">
          <span class="etiqueta">proposta del model</span>
          ${item.suggestedCategoryName}
          ${item.confidence !== null
            ? html`<span class="text-suau">· ${String(Math.round(item.confidence * 100))}%</span>`
            : ""}
          ${item.rationale ? html`<small class="text-suau">${item.rationale}</small>` : ""}
        </p>`
      : ""}

    <form
      class="linia"
      hx-post="/e/${codi}/moviments/${moviment.id}/revisa"
      hx-target="#revisio-${moviment.id}"
      hx-swap="outerHTML"
    >
      ${Tria({
        nom: "category_id",
        etiqueta: "Categoria",
        valor: item.suggestedCategoryId ?? moviment.categoryId,
        grups,
        buit: "— tria una categoria —",
      })}
      <button type="submit" class="boto">Confirma</button>
    </form>
  </li>` as Html;
}

/** Un cop confirmat, l'element se'n va de la cua. */
export function RevisioFeta(id: number): Html {
  return html`<li id="revisio-${id}" hidden></li>` as Html;
}
