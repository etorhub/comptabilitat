/**
 * The pieces a list is drawn with.
 *
 * Ten fragments carried the same shell written by hand — a `div.desplaçable`,
 * a `table.dades`, and a `p.buit` for when there was nothing — and therefore
 * ten chances to get it slightly different.
 *
 * **The empty state and the rows go together on purpose.** Written
 * separately, whoever renders the rows can forget the notice, and that is what
 * happened: deleting a list's last row left a table with a header and an empty
 * body, saying nowhere that there was nothing. Here it cannot: there is no way
 * to ask for the rows without also saying what should be seen when there are
 * none.
 */

import { html } from "hono/html";

import type { Html } from "../lib/html.ts";

/** What is shown when a list has nothing in it. */
export function EmptyState(message: Html | string): Html {
  return html`<p class="buit text-suau">${message}</p>` as Html;
}

export interface DataTableProps {
  /** The header cells, already rendered: `<th>…</th><th>…</th>`. */
  columnes: Html;
  rows: Html[];
  /** What is shown when `rows` is empty. */
  empty: Html | string;
  /** Above the table: an action bar, say. Only shown when there are rows. */
  abans?: Html | "";
  /** Below the table: pagination, a summary. Only shown when there are rows. */
  peu?: Html | "";
  /** An extra class for the `<table>`, when a view has its own. */
  cssClass?: string;
}

/**
 * A data table with its empty state.
 *
 * What goes before and after only appears when there are rows: neither a bar
 * for selecting none of them nor paginating nothing means anything.
 */
export function DataTable({
  columnes,
  rows,
  empty,
  abans = "",
  peu = "",
  cssClass,
}: DataTableProps): Html {
  if (rows.length === 0) return EmptyState(empty);

  return html`${abans}
    <div class="desplaçable">
      <table class="dades${cssClass === undefined ? "" : ` ${cssClass}`}">
        <thead>
          <tr>
            ${columnes}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${peu}` as Html;
}

export interface Page {
  total: number;
  limit: number;
  offset: number;
}

/**
 * "31–60 de 214", with the previous and next buttons.
 *
 * The range is computed here and not in each fragment: one of the two copies
 * said "1–0 de 0" on an empty list, because it counted from `offset + 1`
 * without looking at the total.
 */
export function Pagination({
  page,
  passos,
  summary = "",
}: {
  page: Page;
  passos: Html | "";
  /** Next to the range: a total, a count. */
  summary?: Html | "";
}): Html {
  const desde = page.total === 0 ? 0 : page.offset + 1;
  const fins = Math.min(page.offset + page.limit, page.total);

  return html`<nav class="paginacio" aria-label="Paginacio">
    <span class="text-suau">
      ${String(desde)}–${String(fins)} de ${String(page.total)}${summary}
    </span>
    ${passos}
  </nav>` as Html;
}

/**
 * A small badge next to a name.
 *
 * The title is rendered with a nested template and not with `raw()`: the text
 * can come from a database row, and a quote would break it out of the
 * attribute.
 */
export function Badge(text: string, options: { suau?: boolean; title?: string } = {}): Html {
  const cssClass = options.suau === true ? "etiqueta etiqueta-suau" : "etiqueta";
  return html`<span
    class="${cssClass}"
    ${options.title === undefined ? "" : html`title="${options.title}"`}
    >${text}</span
  >` as Html;
}

/**
 * The spinner shown while a request is in flight.
 *
 * It is always rendered and htmx makes it visible, by putting `.htmx-request`
 * on whichever element `hx-indicator` names for as long as the request lasts;
 * the stylesheet fades it in and out.
 *
 * The two classes that draw it — `.filador` and `.htmx-indicator`, with their
 * `prefers-reduced-motion` — were in the stylesheet from day one and **no**
 * template used them: categorising fifty transactions at once, or moving an
 * account with three hundred, gave no sign of anything, and the actions could
 * be pressed again while the first was still running.
 *
 * `aria-hidden`: a spinning wheel is no use to somebody who cannot see it.
 * Whoever needs to know will know from the button, which is disabled.
 */
export function Spinner(): Html {
  return html`<span class="filador htmx-indicator" aria-hidden="true"></span>` as Html;
}
