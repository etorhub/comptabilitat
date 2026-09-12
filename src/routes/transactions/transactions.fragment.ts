/**
 * Transaction fragments.
 *
 * No template here ever touches a raw row: they only receive `TransactionView`,
 * which has already been through the masking. See `services/transactions.ts`.
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

/** Where the category came from, in Catalan. */
const Origin: Record<CategorySource, { text: string; title: string }> = {
  none: { text: "sense classificar", title: "Encara no te categoria" },
  merchant: { text: "comerç", title: "De la memoria de comerços d'aquest espai" },
  rule: { text: "regla", title: "L'ha posat una regla" },
  llm: { text: "model", title: "Ho proposa el model local; cal confirmar-ho" },
  user: { text: "tu", title: "Ho has decidit tu. No ho canviara res." },
};

const dateCurta = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });

/** Mastercard chip with the last 4 digits. Outside the alias button. */
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
  code: string;
  page: TransactionsPage;
  groups: CategoryGroup[];
  filters: TransactionFilters;
  canEdit: boolean;
  /** Tags already used in the workspace, for the datalist of the add form. */
  knownTags?: string[];
}

export function Table({
  code,
  page,
  groups,
  filters,
  canEdit,
  knownTags = [],
}: TableProps): Html {
  // `taula-carregant` is not decoration: it is the hook that makes the bulk
  // bar's `hx-indicator` dim the rows while the request is in flight. The
  // stylesheet had it and nobody was setting it.
  return html`<div id="taula-moviments" class="taula-carregant">
    ${DataTable({
      // `taula-fitxes`: below 40rem each row is drawn as a card instead of a
      // row. The name of each column comes from the cell's `data-etiqueta`,
      // below.
      cssClass: "taula-moviments taula-fitxes",
      abans: canEdit ? BulkBar({ code, groups, filters }) : "",
      columnes: html`${
        canEdit
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
        Row({ code, transaction, groups, canEdit, knownTags }),
      ),
      empty: "Cap moviment encaixa amb aquests filtres.",
      peu: Pagination({
        page,
        passos: Passos({ code, filters, total: page.total }),
        summary: html` · suma ${formatMoney(page.totalAmount)}` as Html,
      }),
    })}
  </div>` as Html;
}

/**
 * The bulk selection bar.
 *
 * Only visible when some checkbox is ticked (`:has` in the CSS). The «select
 * all» checkbox lives in the table header, always visible.
 *
 * In the React application the selection was a list in the browser's memory,
 * and it survived filter and page changes: you could tick rows, paginate and
 * apply the category to transactions that were no longer visible. Here the
 * selection is the form's checkboxes and nothing else, so what gets applied
 * is always what is on screen.
 */
function BulkBar({
  code,
  groups,
  filters,
}: {
  code: string;
  groups: CategoryGroup[];
  filters: TransactionFilters;
}): Html {
  // The filters go in the URL: without this, the response would return the
  // first unfiltered page and the address bar would say something else.
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
      hx-post="/e/${code}/moviments/bloc${query}"
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
      hx-post="/e/${code}/moviments/bloc/etiquetes${query}"
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
  code,
  filters,
  total,
}: {
  code: string;
  filters: TransactionFilters;
  total: number;
}): Html {
  const last = Math.max(0, Math.ceil(total / PER_PAGE) - 1);
  const link = (p: number) => {
    const q = transactionFiltersToQuery({ ...filters, pagina: p });
    return `/e/${code}/moviments/fragment/taula${q}`;
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
  code: string;
  transaction: TransactionView;
  groups: CategoryGroup[];
  canEdit: boolean;
  /** Show the dropdown even when there is already a category (inline edit). */
  editantCategoria?: boolean;
  knownTags?: string[];
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
  code,
  transaction,
  groups,
  canEdit,
  editantCategoria = false,
}: RowProps): Html {
  const base = `/e/${code}/moviments/${transaction.id}`;
  const origin = Origin[transaction.categorySource];
  const mostraSelect = canEdit && (editantCategoria || transaction.categoryId === null);

  if (!canEdit) {
    return html`
      ${transaction.categoryName ?? html`<span class="text-suau">—</span>`}
      <span class="origen etiqueta etiqueta-suau" title="${origin.title}">${origin.text}</span>
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
        value: transaction.categoryId,
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
  code,
  transaction,
  groups,
  canEdit,
  editantCategoria = false,
  knownTags = [],
}: RowProps): Html {
  const base = `/e/${code}/moviments/${transaction.id}`;
  const negatiu = transaction.amount.startsWith("-");

  return html`<tr
    id="moviment-${transaction.id}"
    class="${transaction.isExcluded ? "exclos" : ""}${editantCategoria ? " editant-categoria" : ""}"
  >
    ${
      canEdit
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
          canEdit
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
            : transaction.operationType === "transferencia"
              ? html`<span class="etiqueta etiqueta-suau" title="Transferencia bancaria"
                >transferència</span
              >`
              : ""
        }
        ${
          transaction.seriesId !== null
            ? html`<a
              class="etiqueta"
              href="/e/${code}/recurrents"
              title="${transaction.seriesLabel ?? "Serie recurrent"}"
              >recurrent</a
            >`
            : ""
        }
        ${TransactionTags({
          code,
          transaction,
          canEdit,
          knownTags,
        })}
      </div>
      ${transaction.notes ? html`<small class="text-suau nota">${transaction.notes}</small>` : ""}
    </td>

    <td class="cel-comerc" data-etiqueta="Comerç">
      ${transaction.merchantName ?? html`<span class="text-suau">—</span>`}
    </td>

    <td class="cel-categoria" data-etiqueta="Categoria">
      ${CategoryCell({ code, transaction, groups, canEdit, editantCategoria })}
    </td>

    <td class="dreta ${negatiu ? "negatiu" : "positiu"}" data-etiqueta="Import">
      ${formatMoney(transaction.amount)}
    </td>
  </tr>` as Html;
}

/**
 * Inline tag chips next to the concept.
 *
 * Each add form belongs to its own row and does **not** share fields with the
 * bulk bar: otherwise HTMX would send everything and the last field would
 * shadow the first.
 */
function TransactionTags({
  code,
  transaction,
  canEdit,
}: {
  code: string;
  transaction: TransactionView;
  canEdit: boolean;
  knownTags: string[];
}): Html {
  const base = `/e/${code}/moviments/${transaction.id}`;
  const xapes = transaction.tags.map((t) => {
    const href = `/e/${code}/etiquetes/${encodeURIComponent(t)}`;
    if (!canEdit) {
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

  const alta = canEdit
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

  if (xapes.length === 0 && !canEdit) return html`` as Html;

  return html`<span class="etiquetes-moviment">${xapes}${alta}</span>` as Html;
}

/** The row turned into a field for typing an alias. */
export function FilaConcepte({
  code,
  transaction,
}: {
  code: string;
  transaction: TransactionView;
}): Html {
  return html`<tr id="moviment-${transaction.id}" class="editant">
    <td colspan="7">
      <form
        class="linia"
        hx-post="/e/${code}/moviments/${transaction.id}/concepte"
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
          hx-get="/e/${code}/moviments/${transaction.id}/fragment/fila"
          hx-target="#moviment-${transaction.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

/** Multiple selector of cards (last 4 digits) used on the account. */
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
        value: t,
        tag: `*${t}`,
        marcat: seleccionades.includes(t),
      }),
    )}
  </fieldset>` as Html;
}

export interface FilterBarProps {
  code: string;
  filters: TransactionFilters;
  accountList: { value: number; text: string }[];
  groups: CategoryGroup[];
  knownTags?: string[];
  knownCards?: string[];
}

export function FilterBar({
  code,
  filters,
  accountList,
  groups,
  knownTags = [],
  knownCards = [],
}: FilterBarProps): Html {
  return html`<form
    class="filtres superficie targeta"
    hx-get="/e/${code}/moviments/fragment/taula"
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
            value: filters.compte,
            options: accountList,
            empty: "— tots —",
          })
        : ""
    }

    ${Select({
      name: "categoria",
      tag: "Categoria",
      value: filters.categoria,
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
      ${OPERATION_TYPE_LABELS.map(({ value, text }) =>
        Checkbox({ name: "tipus", value, tag: text, marcat: filters.type.includes(value) }),
      )}
    </fieldset>

    ${FiltreTargetes({ cards: knownCards, seleccionades: filters.card })}

    ${Checkbox({
      name: "sense_classificar",
      value: "1",
      tag: "Nomes sense classificar",
      marcat: filters.sense_classificar,
    })}

    ${Checkbox({
      name: "revisio",
      value: "1",
      tag: "Nomes per revisar",
      marcat: filters.revisio,
    })}

    ${Checkbox({
      name: "traspassos",
      value: "1",
      tag: "Inclou els traspassos",
      marcat: filters.traspassos,
    })}

    ${TagDatalist(knownTags)}
  </form>` as Html;
}

// --- Review tray -------------------------------------------------------------

export interface ReviewQueueProps {
  code: string;
  items: ReviewItem[];
  groups: CategoryGroup[];
  total: number;
}

export function ReviewQueue({ code, items, groups, total }: ReviewQueueProps): Html {
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
            ${items.map((item) => ReviewCard({ code, item, groups }))}
          </ul>
        `
    }
  </div>` as Html;
}

export function ReviewCard({
  code,
  item,
  groups,
}: {
  code: string;
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
        !transaction.transferGroupId && transaction.operationType === "transferencia"
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
      hx-post="/e/${code}/moviments/${transaction.id}/revisa"
      hx-target="#revisio-${transaction.id}"
      hx-swap="outerHTML"
    >
      ${Select({
        name: "category_id",
        id: `revisio-categoria-${transaction.id}`,
        tag: "Categoria",
        value: item.suggestedCategoryId ?? transaction.categoryId,
        groups,
        empty: "— tria una categoria —",
      })}
      <button type="submit" class="boto">Confirma</button>
    </form>
  </li>` as Html;
}

/** Once confirmed, the item leaves the queue. */
export function ReviewDone(id: number): Html {
  return html`<li id="revisio-${id}" hidden></li>` as Html;
}
