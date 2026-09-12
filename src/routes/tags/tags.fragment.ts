/**
 * Fragments del recurs d'etiquetes.
 */

import { html, raw } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { TagSummary } from "../../services/tags.ts";
import type { TransactionsPage } from "../../services/transactions.ts";
import { Row } from "../transactions/transactions.fragment.ts";
import { PER_PAGE, type TagDetailQuery } from "./tags.schema.ts";

export function TagsList({
  codi,
  tags,
  potEditar,
}: {
  codi: string;
  tags: TagSummary[];
  potEditar: boolean;
}): Html {
  if (tags.length === 0) {
    return html`<div id="llista-etiquetes">
      <p class="buit text-suau">
        Encara no hi ha cap etiqueta. Afegeix-ne una des d'un moviment: escriu
        un nom com «casament» o «projecteX» a la fila.
      </p>
    </div>` as Html;
  }

  return html`<div id="llista-etiquetes" class="desplaçable">
    <table class="dades">
      <thead>
        <tr>
          <th>Etiqueta</th>
          <th class="dreta">Moviments</th>
          <th class="dreta">Ingressos</th>
          <th class="dreta">Despeses</th>
          <th class="dreta">Net</th>
          ${potEditar ? html`<th></th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${tags.map((e) => SummaryRow({ codi, summary: e, potEditar }))}
      </tbody>
    </table>
  </div>` as Html;
}

function SummaryRow({
  codi,
  summary,
  potEditar,
}: {
  codi: string;
  summary: TagSummary;
  potEditar: boolean;
}): Html {
  const href = `/e/${codi}/etiquetes/${encodeURIComponent(summary.name)}`;
  const cleanNegative = summary.net.startsWith("-");
  return html`<tr>
    <td>
      <a href="${href}">${summary.name}</a>
    </td>
    <td class="dreta">${String(summary.transactionCount)}</td>
    <td class="dreta positiu">${formatMoney(summary.income)}</td>
    <td class="dreta negatiu">${formatMoney(summary.expenses)}</td>
    <td class="dreta ${cleanNegative ? "negatiu" : "positiu"}">${formatMoney(summary.net)}</td>
    ${
      potEditar
        ? html`<td class="dreta">
          <button
            type="button"
            class="boto boto-discret"
            hx-post="/e/${codi}/etiquetes/${encodeURIComponent(summary.name)}/esborra"
            hx-confirm="Treure «${summary.name}» de tots els moviments d'aquest espai?"
          >
            Esborra
          </button>
        </td>`
        : ""
    }
  </tr>` as Html;
}

export function CapAleraDetail({
  codi,
  summary,
  potEditar,
}: {
  codi: string;
  summary: TagSummary;
  potEditar: boolean;
}): Html {
  const cleanNegative = summary.net.startsWith("-");
  return html`<header class="capçalera">
    <p class="text-suau">
      <a href="/e/${codi}/etiquetes">← Etiquetes</a>
    </p>
    <div class="capçalera-fila">
      <h1>
        <span class="etiqueta etiqueta-dada">${summary.name}</span>
      </h1>
      ${
        potEditar
          ? html`<div class="capçalera-accions">
            <button
              type="button"
              class="boto boto-discret"
              hx-post="/e/${codi}/etiquetes/${encodeURIComponent(summary.name)}/esborra"
              hx-confirm="Treure «${summary.name}» de tots els moviments d'aquest espai?"
            >
              Esborra de tots els moviments
            </button>
          </div>`
          : ""
      }
    </div>
    <p class="text-suau">
      ${String(summary.transactionCount)}
      ${summary.transactionCount === 1 ? "moviment" : "moviments"} · ingressos
      ${formatMoney(summary.income)} · despeses ${formatMoney(summary.expenses)} · net
      <span class="${cleanNegative ? "negatiu" : "positiu"}">${formatMoney(summary.net)}</span>
    </p>
  </header>` as Html;
}

export function DetailTable({
  codi,
  name,
  page,
  groups,
  potEditar,
  query,
  etiquetesConegudes,
}: {
  codi: string;
  name: string;
  page: TransactionsPage;
  groups: CategoryGroup[];
  potEditar: boolean;
  query: TagDetailQuery;
  etiquetesConegudes: string[];
}): Html {
  const desde = page.total === 0 ? 0 : page.offset + 1;
  const fins = Math.min(page.offset + page.limit, page.total);
  const enc = encodeURIComponent(name);

  return html`<div id="taula-etiqueta">
    ${
      page.items.length === 0
        ? html`<p class="buit text-suau">Cap moviment amb aquesta etiqueta.</p>`
        : html`
          <div class="desplaçable">
            <table class="dades taula-moviments">
              <thead>
                <tr>
                  ${potEditar ? html`<th class="tria"></th>` : ""}
                  <th>Data</th>
                  <th>Concepte</th>
                  <th>Comerç</th>
                  <th>Categoria</th>
                  <th class="dreta">Import</th>
                </tr>
              </thead>
              <tbody>
                ${page.items.map((transaction) =>
                  Row({
                    codi,
                    transaction,
                    groups,
                    potEditar,
                    etiquetesConegudes,
                  }),
                )}
              </tbody>
            </table>
          </div>
          <nav class="paginacio" aria-label="Paginacio">
            <span class="text-suau">
              ${String(desde)}–${String(fins)} de ${String(page.total)} · suma
              ${formatMoney(page.totalImport)}
            </span>
            ${DetailSteps({ codi, enc, query, total: page.total })}
          </nav>
        `
    }
  </div>` as Html;
}

function DetailSteps({
  codi,
  enc,
  query,
  total,
}: {
  codi: string;
  enc: string;
  query: TagDetailQuery;
  total: number;
}): Html {
  const last = Math.max(0, Math.ceil(total / PER_PAGE) - 1);
  const link = (p: number) => {
    const params = p > 0 ? `?pagina=${p}` : "";
    return `/e/${codi}/etiquetes/${enc}/fragment/taula${params}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${query.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${link(query.pagina - 1)}"
      hx-target="#taula-etiqueta"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${query.pagina >= last ? raw("disabled") : ""}
      hx-get="${link(query.pagina + 1)}"
      hx-target="#taula-etiqueta"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}
