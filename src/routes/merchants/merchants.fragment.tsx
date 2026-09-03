/**
 * Fragments dels comerços.
 *
 * La cerca es un `hx-get` amb `delay:300ms`: l'aplicacio de React feia una
 * peticio a cada tecla, sense cap espera.
 */

import { html, raw } from "hono/html";

import { Tria } from "../../components/form.tsx";
import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ComercVista, PaginaComercos } from "../../services/merchants.ts";
import { PER_PAGINA, type MerchantFilters } from "./merchants.schema.ts";

const dataCurta = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export interface TaulaProps {
  codi: string;
  pagina: PaginaComercos;
  grups: GrupCategories[];
  filters: MerchantFilters;
  potEditar: boolean;
}

export function Taula({ codi, pagina, grups, filters, potEditar }: TaulaProps): Html {
  const desde = pagina.offset + 1;
  const fins = Math.min(pagina.offset + pagina.limit, pagina.total);

  return html`<div id="taula-comercos">
    ${
      pagina.items.length === 0
        ? html`<p class="buit text-suau">
          ${
            filters.cerca
              ? html`No hi ha cap comerç que encaixi amb «${filters.cerca}».`
              : "Encara no hi ha cap comerç. N'apareixeran a mesura que s'importin moviments."
          }
        </p>`
        : html`
          <div class="desplaçable">
            <table class="dades">
              <thead>
                <tr>
                  <th>Comerç</th>
                  <th>Categoria per defecte</th>
                  <th class="dreta">Moviments</th>
                  <th>Vist per ultim cop</th>
                </tr>
              </thead>
              <tbody>
                ${pagina.items.map((comerc) => Fila({ codi, comerc, grups, potEditar }))}
              </tbody>
            </table>
          </div>

          <nav class="paginacio" aria-label="Paginacio">
            <span class="text-suau">
              ${String(desde)}–${String(fins)} de ${String(pagina.total)}
            </span>
            ${Passos({ codi, filters, total: pagina.total })}
          </nav>
        `
    }
  </div>` as Html;
}

function Passos({
  codi,
  filters,
  total,
}: {
  codi: string;
  filters: MerchantFilters;
  total: number;
}): Html {
  const ultima = Math.max(0, Math.ceil(total / PER_PAGINA) - 1);
  const enllac = (p: number) => {
    const params = new URLSearchParams();
    if (filters.cerca) params.set("cerca", filters.cerca);
    if (filters.sense_classificar) params.set("sense_classificar", "1");
    if (filters.sense_confirmar) params.set("sense_confirmar", "1");
    if (p > 0) params.set("pagina", String(p));
    return `/e/${codi}/comercos/fragment/taula?${params.toString()}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina - 1)}"
      hx-target="#taula-comercos"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= ultima ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina + 1)}"
      hx-target="#taula-comercos"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}

export interface FilaProps {
  codi: string;
  comerc: ComercVista;
  grups: GrupCategories[];
  potEditar: boolean;
}

export function Fila({ codi, comerc, grups, potEditar }: FilaProps): Html {
  const base = `/e/${codi}/comercos/${comerc.id}`;

  return html`<tr id="comerc-${comerc.id}">
    <td>
      <span class="nom">${comerc.displayName}</span>
      ${
        comerc.isConfirmed
          ? html`<span class="etiqueta" title="Ho ha confirmat una persona">confirmat</span>`
          : ""
      }
      <br />
      <small class="text-suau">${comerc.normalizedName}</small>
    </td>
    <td>
      ${
        potEditar
          ? Tria({
              nom: "default_category_id",
              etiqueta: `Categoria de ${comerc.displayName}`,
              valor: comerc.defaultCategoryId,
              grups,
              buit: "— sense classificar —",
              atributs: `hx-post="${base}/categoria" hx-target="#comerc-${comerc.id}" hx-swap="outerHTML" hx-trigger="change"`,
            })
          : (comerc.categoryName ?? html`<span class="text-suau">sense classificar</span>`)
      }
    </td>
    <td class="dreta">${String(comerc.transactionCount)}</td>
    <td>
      ${
        comerc.lastSeenAt
          ? dataCurta.format(new Date(`${comerc.lastSeenAt}T00:00:00`))
          : html`<span class="text-suau">—</span>`
      }
    </td>
  </tr>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: MerchantFilters;
}

export function BarraFiltres({ codi, filters }: BarraFiltresProps): Html {
  return html`<form
    class="filtres superficie targeta"
    hx-get="/e/${codi}/comercos/fragment/taula"
    hx-target="#taula-comercos"
    hx-swap="outerHTML"
    hx-trigger="change, keyup changed delay:300ms from:input[name='cerca']"
  >
    <label class="camp camp-linia">
      <span class="camp-etiqueta">Cerca</span>
      <input
        type="search"
        name="cerca"
        value="${filters.cerca}"
        placeholder="Nom del comerç"
        autocomplete="off"
      />
    </label>

    <label class="casella">
      <input
        type="checkbox"
        name="sense_classificar"
        value="1"
        ${filters.sense_classificar ? raw("checked") : ""}
      />
      <span>Nomes els que no tenen categoria</span>
    </label>

    <label class="casella">
      <input
        type="checkbox"
        name="sense_confirmar"
        value="1"
        ${filters.sense_confirmar ? raw("checked") : ""}
      />
      <span>Nomes els que no ha confirmat ningu</span>
    </label>
  </form>` as Html;
}
