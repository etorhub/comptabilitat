/**
 * Fragments del recurs d'etiquetes.
 */

import { html, raw } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ResumEtiqueta } from "../../services/tags.ts";
import type { PaginaMoviments } from "../../services/transactions.ts";
import { Fila } from "../transactions/transactions.fragment.tsx";
import { PER_PAGINA, type TagDetailQuery } from "./tags.schema.ts";

export function LlistaEtiquetes({
  codi,
  etiquetes,
  potEditar,
}: {
  codi: string;
  etiquetes: ResumEtiqueta[];
  potEditar: boolean;
}): Html {
  if (etiquetes.length === 0) {
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
        ${etiquetes.map((e) => FilaResum({ codi, resum: e, potEditar }))}
      </tbody>
    </table>
  </div>` as Html;
}

function FilaResum({
  codi,
  resum,
  potEditar,
}: {
  codi: string;
  resum: ResumEtiqueta;
  potEditar: boolean;
}): Html {
  const href = `/e/${codi}/etiquetes/${encodeURIComponent(resum.nom)}`;
  const netNegatiu = resum.net.startsWith("-");
  return html`<tr>
    <td>
      <a href="${href}">${resum.nom}</a>
    </td>
    <td class="dreta">${String(resum.moviments)}</td>
    <td class="dreta positiu">${formatMoney(resum.ingressos)}</td>
    <td class="dreta negatiu">${formatMoney(resum.despeses)}</td>
    <td class="dreta ${netNegatiu ? "negatiu" : "positiu"}">${formatMoney(resum.net)}</td>
    ${
      potEditar
        ? html`<td class="dreta">
          <button
            type="button"
            class="boto boto-discret"
            hx-post="/e/${codi}/etiquetes/${encodeURIComponent(resum.nom)}/esborra"
            hx-confirm="Treure «${resum.nom}» de tots els moviments d'aquest espai?"
          >
            Esborra
          </button>
        </td>`
        : ""
    }
  </tr>` as Html;
}

export function CapçaleraDetall({
  codi,
  resum,
  potEditar,
}: {
  codi: string;
  resum: ResumEtiqueta;
  potEditar: boolean;
}): Html {
  const netNegatiu = resum.net.startsWith("-");
  return html`<header class="capçalera">
    <p class="text-suau">
      <a href="/e/${codi}/etiquetes">← Etiquetes</a>
    </p>
    <div class="capçalera-fila">
      <h1>
        <span class="etiqueta etiqueta-dada">${resum.nom}</span>
      </h1>
      ${
        potEditar
          ? html`<div class="capçalera-accions">
            <button
              type="button"
              class="boto boto-discret"
              hx-post="/e/${codi}/etiquetes/${encodeURIComponent(resum.nom)}/esborra"
              hx-confirm="Treure «${resum.nom}» de tots els moviments d'aquest espai?"
            >
              Esborra de tots els moviments
            </button>
          </div>`
          : ""
      }
    </div>
    <p class="text-suau">
      ${String(resum.moviments)}
      ${resum.moviments === 1 ? "moviment" : "moviments"} · ingressos
      ${formatMoney(resum.ingressos)} · despeses ${formatMoney(resum.despeses)} · net
      <span class="${netNegatiu ? "negatiu" : "positiu"}">${formatMoney(resum.net)}</span>
    </p>
  </header>` as Html;
}

export function TaulaDetall({
  codi,
  nom,
  pagina,
  grups,
  potEditar,
  query,
  etiquetesConegudes,
}: {
  codi: string;
  nom: string;
  pagina: PaginaMoviments;
  grups: GrupCategories[];
  potEditar: boolean;
  query: TagDetailQuery;
  etiquetesConegudes: string[];
}): Html {
  const desde = pagina.total === 0 ? 0 : pagina.offset + 1;
  const fins = Math.min(pagina.offset + pagina.limit, pagina.total);
  const enc = encodeURIComponent(nom);

  return html`<div id="taula-etiqueta">
    ${
      pagina.items.length === 0
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
                ${pagina.items.map((moviment) =>
                  Fila({ codi, moviment, grups, potEditar, etiquetesConegudes }),
                )}
              </tbody>
            </table>
          </div>
          <nav class="paginacio" aria-label="Paginacio">
            <span class="text-suau">
              ${String(desde)}–${String(fins)} de ${String(pagina.total)} · suma
              ${formatMoney(pagina.totalImport)}
            </span>
            ${PassosDetall({ codi, enc, query, total: pagina.total })}
          </nav>
        `
    }
  </div>` as Html;
}

function PassosDetall({
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
  const ultima = Math.max(0, Math.ceil(total / PER_PAGINA) - 1);
  const enllac = (p: number) => {
    const params = p > 0 ? `?pagina=${p}` : "";
    return `/e/${codi}/etiquetes/${enc}/fragment/taula${params}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${query.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${enllac(query.pagina - 1)}"
      hx-target="#taula-etiqueta"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${query.pagina >= ultima ? raw("disabled") : ""}
      hx-get="${enllac(query.pagina + 1)}"
      hx-target="#taula-etiqueta"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}
