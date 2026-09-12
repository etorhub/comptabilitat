/**
 * Fragments dels moviments.
 *
 * Cap plantilla d'aqui no toca mai una fila crua: nomes reben `MovimentVista`,
 * que ja ha passat per l'emmascarament. Vegeu `services/transactions.ts`.
 */

import { html, raw } from "hono/html";

import { Checkbox, Select } from "../../components/form.ts";
import type { CategorySource } from "../../db/schema/index.ts";
import { Spinner, Pagination, DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import { oobAttributes } from "../../lib/oob.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type {
  ReviewItem,
  TransactionView,
  TransactionsPage,
} from "../../services/transactions.ts";
import {
  OPERATION_TYPE_LABELS,
  PER_PAGE,
  transactionFiltersToQuery,
  type TransactionFilters,
} from "./transactions.schema.ts";

/** D'on ha sortit la categoria, en català. */
const Origin: Record<CategorySource, { text: string; titol: string }> = {
  none: { text: "sense classificar", titol: "Encara no te categoria" },
  merchant: { text: "comerç", titol: "De la memoria de comerços d'aquest espai" },
  rule: { text: "regla", titol: "L'ha posat una regla" },
  llm: { text: "model", titol: "Ho proposa el model local; cal confirmar-ho" },
  user: { text: "tu", titol: "Ho has decidit tu. No ho canviara res." },
};

const dateCurta = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

/** Xip Mastercard amb els darrers 4 digits. Fora del boto d'alias. */
function CardChip({ darrers4 }: { darrers4: string | null }): Html {
  if (!darrers4) return html`` as Html;
  return html`<span
    class="xip-targeta"
    aria-label="Targeta acabada en ${darrers4}"
    title="Targeta acabada en ${darrers4}"
  >
    <svg
      class="xip-targeta-icona"
      viewBox="0 0 38 24"
      width="22"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" fill="#eb001b" />
      <circle cx="26" cy="12" r="10" fill="#f79e1b" />
      <path
        d="M19 5.2a10 10 0 0 0 0 13.6 10 10 0 0 0 0-13.6z"
        fill="#ff5f00"
      />
    </svg>
    <span class="xip-targeta-digits">*${darrers4}</span>
  </span>` as Html;
}

export interface TableProps {
  codi: string;
  page: TransactionsPage;
  groups: CategoryGroup[];
  filters: TransactionFilters;
  potEditar: boolean;
  /** Etiquetes ja usades a l'espai, per al datalist d'alta. */
  etiquetesConegudes?: string[];
}

export function Table({
  codi,
  page,
  groups,
  filters,
  potEditar,
  etiquetesConegudes = [],
}: TableProps): Html {
  // `taula-carregant` no es decoracio: es el ganxo que fa que
  // l'`hx-indicator` de la barra de bloc enfosqueixi les files mentre la
  // peticio corre. El full d'estil el tenia i ningu no el posava.
  return html`<div id="taula-moviments" class="taula-carregant">
    ${DataTable({
      // `taula-fitxes`: per sota de 40rem cada fila es dibuixa com una fitxa
      // en comptes d'una fila. El nom de cada columna surt de la
      // `data-etiqueta` de la cel·la, aqui sota.
      cssClass: "taula-moviments taula-fitxes",
      abans: potEditar ? BulkBar({ codi, groups, filters }) : "",
      columnes: html`${
        potEditar
          ? html`<th class="tria">
            <input
              type="checkbox"
              aria-label="Tria'ls tots"
              onclick="document.querySelectorAll('#taula-moviments input[name=moviment]').forEach(function(c){c.checked=this.checked}.bind(this))"
            />
          </th>`
          : ""
      }
        <th>Data</th>
        <th>Concepte</th>
        <th>Comerç</th>
        <th>Categoria</th>
        <th class="dreta">Import</th>` as Html,
      rows: page.items.map((transaction) =>
        Row({ codi, transaction, groups, potEditar, etiquetesConegudes }),
      ),
      empty: "Cap moviment encaixa amb aquests filtres.",
      peu: Pagination({
        page,
        passos: Passos({ codi, filters, total: page.total }),
        summary: html` · suma ${formatMoney(page.totalImport)}` as Html,
      }),
    })}
  </div>` as Html;
}

/**
 * La barra de la seleccio en bloc.
 *
 * Nomes es veu quan hi ha alguna casella marcada (`:has` al CSS). La casella
 * «tria'ls tots» viu al capçal de la taula, sempre visible.
 *
 * A l'aplicacio de React la seleccio era una llista a la memoria del
 * navegador, i sobrevivia als canvis de filtre i de pagina: es podien marcar
 * files, paginar i aplicar la categoria a moviments que ja no es veien. Aqui
 * la seleccio son les caselles del formulari i prou, de manera que el que
 * s'aplica es sempre el que es veu.
 */
function BulkBar({
  codi,
  groups,
  filters,
}: {
  codi: string;
  groups: CategoryGroup[];
  filters: TransactionFilters;
}): Html {
  // Els filtres van a l'adreça: sense aixo, la resposta tornaria la primera
  // pagina sense filtrar i la barra d'adreces diria una altra cosa.
  const query = transactionFiltersToQuery(filters);
  return html`<div class="barra-bloc">
    ${Select({
      name: "category_id",
      id: "bloc-categoria",
      tag: "Posa'ls la categoria",
      groups,
      empty: "— tria una categoria —",
    })}

    <button
      type="button"
      class="boto"
      hx-post="/e/${codi}/moviments/bloc${query}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
      hx-include="#bloc-categoria, #taula-moviments input[name='moviment']:checked"
      hx-indicator="#taula-moviments, this"
      hx-disabled-elt="this"
    >
      ${Spinner()} Aplica-la als triats
    </button>

    <label class="camp camp-linia camp-estret">
      <span class="camp-etiqueta">Etiqueta</span>
      <input
        type="text"
        name="etiqueta_bloc"
        id="bloc-etiqueta"
        list="etiquetes-espai"
        maxlength="40"
        autocomplete="off"
        placeholder="casament…"
      />
    </label>
    <button
      type="button"
      class="boto boto-discret"
      hx-post="/e/${codi}/moviments/bloc/etiquetes${query}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
      hx-include="#bloc-etiqueta, #taula-moviments input[name='moviment']:checked"
      hx-indicator="#taula-moviments"
    >
      Posa l'etiqueta als triats
    </button>
  </div>` as Html;
}

function TagDatalist(tags: string[]): Html {
  if (tags.length === 0) return html`` as Html;
  return html`<datalist id="etiquetes-espai">
    ${tags.map((t) => html`<option value="${t}"></option>`)}
  </datalist>` as Html;
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
  const last = Math.max(0, Math.ceil(total / PER_PAGE) - 1);
  const link = (p: number) => {
    const q = transactionFiltersToQuery({ ...filters, pagina: p });
    return `/e/${codi}/moviments/fragment/taula${q}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${link(filters.pagina - 1)}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= last ? raw("disabled") : ""}
      hx-get="${link(filters.pagina + 1)}"
      hx-target="#taula-moviments"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}

export interface RowProps {
  codi: string;
  transaction: TransactionView;
  groups: CategoryGroup[];
  potEditar: boolean;
  /** Mostra el desplegable encara que ja hi hagi categoria (edicio inline). */
  editantCategoria?: boolean;
  etiquetesConegudes?: string[];
}

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

function CategoryCell({
  codi,
  transaction,
  groups,
  potEditar,
  editantCategoria = false,
}: RowProps): Html {
  const base = `/e/${codi}/moviments/${transaction.id}`;
  const origin = Origin[transaction.categorySource];
  const mostraSelect = potEditar && (editantCategoria || transaction.categoryId === null);

  if (!potEditar) {
    return html`
      ${transaction.categoryName ?? html`<span class="text-suau">—</span>`}
      <span class="origen etiqueta etiqueta-suau" title="${origin.titol}">${origin.text}</span>
      ${
        transaction.needsReview
          ? html`<span class="etiqueta" title="Cal que algu ho confirmi">per revisar</span>`
          : ""
      }
    ` as Html;
  }

  if (mostraSelect) {
    return html`
      ${Select({
        name: "category_id",
        id: `categoria-${transaction.id}`,
        tag: `Categoria de ${transaction.description}`,
        valor: transaction.categoryId,
        groups,
        empty: "— sense classificar —",
        attributes: `hx-post="${base}/categoria" hx-target="#moviment-${transaction.id}" hx-swap="outerHTML" hx-trigger="change"`,
      })}
      ${
        editantCategoria
          ? html`<button
            type="button"
            class="boto boto-discret"
            hx-get="${base}/fragment/fila"
            hx-target="#moviment-${transaction.id}"
            hx-swap="outerHTML"
          >
            Cancel·la
          </button>`
          : ""
      }
      ${
        transaction.needsReview
          ? html`<span class="etiqueta" title="Cal que algu ho confirmi">per revisar</span>`
          : ""
      }
    ` as Html;
  }

  return html`
    <span class="categoria-compacta">
      <span>${transaction.categoryName}</span>
      <button
        type="button"
        class="boto-icona"
        aria-label="Edita la categoria"
        title="Edita la categoria"
        hx-get="${base}/fragment/categoria"
        hx-target="#moviment-${transaction.id}"
        hx-swap="outerHTML"
      >
        ${iconLlapis}
      </button>
    </span>
    ${
      transaction.needsReview
        ? html`<span class="etiqueta" title="Cal que algu ho confirmi">per revisar</span>`
        : ""
    }
  ` as Html;
}

export function Row({
  codi,
  transaction,
  groups,
  potEditar,
  editantCategoria = false,
  etiquetesConegudes = [],
}: RowProps): Html {
  const base = `/e/${codi}/moviments/${transaction.id}`;
  const negatiu = transaction.amount.startsWith("-");

  return html`<tr
    id="moviment-${transaction.id}"
    class="${transaction.isExcluded ? "exclos" : ""}${editantCategoria ? " editant-categoria" : ""}"
  >
    ${
      potEditar
        ? html`<td class="tria" data-etiqueta="Tria">
          <input
            type="checkbox"
            name="moviment"
            value="${transaction.id}"
            aria-label="Tria el moviment de ${transaction.description}"
          />
        </td>`
        : ""
    }

    <td class="data" data-etiqueta="Data">
      <time datetime="${transaction.bookingDate}">
        ${dateCurta.format(new Date(`${transaction.bookingDate}T00:00:00`))}
      </time>
      ${
        transaction.status === "pending"
          ? html`<span class="etiqueta etiqueta-suau" title="Encara no es definitiu">pendent</span>`
          : ""
      }
    </td>

    <td class="cel-concepte" data-etiqueta="Concepte">
      <div class="concepte-linia">
        ${
          potEditar
            ? html`<button
              type="button"
              class="concepte"
              title="${transaction.descriptionHint ?? "Canvia com es veu aquest concepte"}"
              hx-get="${base}/fragment/concepte"
              hx-target="#moviment-${transaction.id}"
              hx-swap="outerHTML"
            >
              ${transaction.description}
            </button>`
            : html`<span>${transaction.description}</span>`
        }
        ${CardChip({ darrers4: transaction.darrers4 })}
        ${
          transaction.transferGroupId
            ? html`<span class="etiqueta etiqueta-suau" title="Traspas entre comptes propis"
              >traspas</span
            >`
            : transaction.tipusOperacio === "transferencia"
              ? html`<span class="etiqueta etiqueta-suau" title="Transferencia bancaria"
                >transferència</span
              >`
              : ""
        }
        ${
          transaction.serieId !== null
            ? html`<a
              class="etiqueta"
              href="/e/${codi}/recurrents"
              title="${transaction.serieLabel ?? "Serie recurrent"}"
              >recurrent</a
            >`
            : ""
        }
        ${TransactionTags({
          codi,
          transaction,
          potEditar,
          etiquetesConegudes,
        })}
      </div>
      ${transaction.notes ? html`<small class="text-suau nota">${transaction.notes}</small>` : ""}
    </td>

    <td class="cel-comerc" data-etiqueta="Comerç">
      ${transaction.merchantName ?? html`<span class="text-suau">—</span>`}
    </td>

    <td class="cel-categoria" data-etiqueta="Categoria">
      ${CategoryCell({ codi, transaction, groups, potEditar, editantCategoria })}
    </td>

    <td class="dreta ${negatiu ? "negatiu" : "positiu"}" data-etiqueta="Import">
      ${formatMoney(transaction.amount)}
    </td>
  </tr>` as Html;
}

/**
 * Xapes d'etiquetes en linia amb el concepte.
 *
 * Cada formulari d'alta es propi de la fila i **no** comparteix camps amb la
 * barra de bloc: si no, HTMX enviaria tot i el darrer camp taparia el primer.
 */
function TransactionTags({
  codi,
  transaction,
  potEditar,
}: {
  codi: string;
  transaction: TransactionView;
  potEditar: boolean;
  etiquetesConegudes: string[];
}): Html {
  const base = `/e/${codi}/moviments/${transaction.id}`;
  const xapes = transaction.tags.map((t) => {
    const href = `/e/${codi}/etiquetes/${encodeURIComponent(t)}`;
    if (!potEditar) {
      return html`<a class="etiqueta etiqueta-dada" href="${href}">${t}</a>`;
    }
    return html`<form
      class="xapa-etiqueta"
      hx-post="${base}/etiquetes/treure"
      hx-target="#moviment-${transaction.id}"
      hx-swap="outerHTML"
    >
      <a class="etiqueta etiqueta-dada" href="${href}">${t}</a>
      <input type="hidden" name="etiqueta" value="${t}" />
      <button
        type="submit"
        class="boto-xapa"
        aria-label="Treu l'etiqueta ${t}"
        title="Treu l'etiqueta"
      >
        ×
      </button>
    </form>`;
  });

  const alta = potEditar
    ? html`<form
        class="alta-etiqueta"
        hx-post="${base}/etiquetes"
        hx-target="#moviment-${transaction.id}"
        hx-swap="outerHTML"
      >
        <label class="visualment-ocult" for="nova-etiqueta-${transaction.id}">
          Afegeix una etiqueta
        </label>
        <input
          type="text"
          name="nova_etiqueta"
          id="nova-etiqueta-${transaction.id}"
          list="etiquetes-espai"
          maxlength="40"
          autocomplete="off"
          placeholder="+"
          aria-label="Afegeix una etiqueta a ${transaction.description}"
        />
      </form>`
    : "";

  if (xapes.length === 0 && !potEditar) return html`` as Html;

  return html`<span class="etiquetes-moviment">${xapes}${alta}</span>` as Html;
}

/** La fila convertida en un camp per posar-hi un alias. */
export function FilaConcepte({
  codi,
  transaction,
}: {
  codi: string;
  transaction: TransactionView;
}): Html {
  return html`<tr id="moviment-${transaction.id}" class="editant">
    <td colspan="7">
      <form
        class="linia"
        hx-post="/e/${codi}/moviments/${transaction.id}/concepte"
        hx-target="#moviment-${transaction.id}"
        hx-swap="outerHTML"
      >
        <label class="camp camp-linia">
          <span class="camp-etiqueta">Com vols que es vegi</span>
          <input
            type="text"
            name="display_description"
            value="${transaction.isMasked ? transaction.description : ""}"
            maxlength="200"
            placeholder="${transaction.description}"
            title="${transaction.descriptionHint ?? ""}"
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
          hx-get="/e/${codi}/moviments/${transaction.id}/fragment/fila"
          hx-target="#moviment-${transaction.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

/** Selector multiple de targetes (darrers 4 digits) fetes servir al compte. */
export function FiltreTargetes({
  cards,
  seleccionades,
  oob = false,
}: {
  cards: string[];
  seleccionades: string[];
  oob?: boolean;
}): Html {
  if (cards.length === 0) return html`` as Html;
  return html`<fieldset
    ${oobAttributes("filtre-targetes", oob)}
    class="filtre-tipus filtre-targetes"
  >
    <legend class="camp-etiqueta">Targeta</legend>
    ${cards.map((t) =>
      Checkbox({
        name: "targeta",
        valor: t,
        tag: `*${t}`,
        marcat: seleccionades.includes(t),
      }),
    )}
  </fieldset>` as Html;
}

export interface FilterBarProps {
  codi: string;
  filters: TransactionFilters;
  accountList: { valor: number; text: string }[];
  groups: CategoryGroup[];
  etiquetesConegudes?: string[];
  targetesConegudes?: string[];
}

export function FilterBar({
  codi,
  filters,
  accountList,
  groups,
  etiquetesConegudes = [],
  targetesConegudes = [],
}: FilterBarProps): Html {
  return html`<form
    class="filtres superficie targeta"
    hx-get="/e/${codi}/moviments/fragment/taula"
    hx-target="#taula-moviments"
    hx-swap="outerHTML"
    hx-trigger="change, keyup changed delay:300ms from:input[name='cerca'], keyup changed delay:300ms from:input[name='etiqueta']"
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

    ${
      accountList.length > 1
        ? Select({
            name: "compte",
            tag: "Compte",
            valor: filters.compte,
            options: accountList,
            empty: "— tots —",
          })
        : ""
    }

    ${Select({
      name: "categoria",
      tag: "Categoria",
      valor: filters.categoria,
      groups,
      empty: "— totes —",
    })}

    <label class="camp camp-linia camp-estret">
      <span class="camp-etiqueta">Etiqueta</span>
      <input
        type="text"
        name="etiqueta"
        value="${filters.etiqueta ?? ""}"
        maxlength="40"
        list="etiquetes-espai"
        autocomplete="off"
        placeholder="casament…"
      />
    </label>

    <fieldset class="filtre-tipus">
      <legend class="camp-etiqueta">Tipus</legend>
      ${OPERATION_TYPE_LABELS.map(({ valor, text }) =>
        Checkbox({ name: "tipus", valor, tag: text, marcat: filters.type.includes(valor) }),
      )}
    </fieldset>

    ${FiltreTargetes({ cards: targetesConegudes, seleccionades: filters.card })}

    ${Checkbox({
      name: "sense_classificar",
      valor: "1",
      tag: "Nomes sense classificar",
      marcat: filters.sense_classificar,
    })}

    ${Checkbox({
      name: "revisio",
      valor: "1",
      tag: "Nomes per revisar",
      marcat: filters.revisio,
    })}

    ${Checkbox({
      name: "traspassos",
      valor: "1",
      tag: "Inclou els traspassos",
      marcat: filters.traspassos,
    })}

    ${TagDatalist(etiquetesConegudes)}
  </form>` as Html;
}

// --- Safata de revisio -------------------------------------------------------

export interface ReviewQueueProps {
  codi: string;
  items: ReviewItem[];
  groups: CategoryGroup[];
  total: number;
}

export function ReviewQueue({ codi, items, groups, total }: ReviewQueueProps): Html {
  return html`<div id="cua-revisio">
    ${
      items.length === 0
        ? html`<p class="buit text-suau">
          No hi ha res per revisar. Tot te categoria.
        </p>`
        : html`
          <p class="text-suau">
            ${String(total)} ${total === 1 ? "moviment espera" : "moviments esperen"} que algu
            en confirmi la categoria.
          </p>
          <ul class="revisio">
            ${items.map((item) => ReviewCard({ codi, item, groups }))}
          </ul>
        `
    }
  </div>` as Html;
}

export function ReviewCard({
  codi,
  item,
  groups,
}: {
  codi: string;
  item: ReviewItem;
  groups: CategoryGroup[];
}): Html {
  const { transaction } = item;
  const negatiu = transaction.amount.startsWith("-");

  return html`<li id="revisio-${transaction.id}" class="superficie targeta item-revisio">
    <div class="item-cap">
      <time datetime="${transaction.bookingDate}" class="text-suau">
        ${dateCurta.format(new Date(`${transaction.bookingDate}T00:00:00`))}
      </time>
      <strong title="${transaction.descriptionHint ?? ""}">${transaction.description}</strong>
      ${CardChip({ darrers4: transaction.darrers4 })}
      ${
        !transaction.transferGroupId && transaction.tipusOperacio === "transferencia"
          ? html`<span class="etiqueta etiqueta-suau">transferència</span>`
          : ""
      }
      <span class="${negatiu ? "negatiu" : "positiu"}">${formatMoney(transaction.amount)}</span>
    </div>

    ${transaction.merchantName ? html`<p class="text-suau">${transaction.merchantName}</p>` : ""}

    ${
      item.suggestedCategoryName
        ? html`<p class="proposta">
          <span class="etiqueta">proposta del model</span>
          ${item.suggestedCategoryName}
          ${
            item.confidence !== null
              ? html`<span class="text-suau">· ${String(Math.round(item.confidence * 100))}%</span>`
              : ""
          }
          ${item.rationale ? html`<small class="text-suau">${item.rationale}</small>` : ""}
        </p>`
        : ""
    }

    <form
      class="linia"
      hx-post="/e/${codi}/moviments/${transaction.id}/revisa"
      hx-target="#revisio-${transaction.id}"
      hx-swap="outerHTML"
    >
      ${Select({
        name: "category_id",
        id: `revisio-categoria-${transaction.id}`,
        tag: "Categoria",
        valor: item.suggestedCategoryId ?? transaction.categoryId,
        groups,
        empty: "— tria una categoria —",
      })}
      <button type="submit" class="boto">Confirma</button>
    </form>
  </li>` as Html;
}

/** Un cop confirmat, l'element se'n va de la cua. */
export function ReviewDone(id: number): Html {
  return html`<li id="revisio-${id}" hidden></li>` as Html;
}
