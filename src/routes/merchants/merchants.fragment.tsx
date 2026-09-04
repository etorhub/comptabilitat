/**
 * Fragments dels comerços.
 *
 * La cerca es un `hx-get` amb `delay:300ms`: l'aplicacio de React feia una
 * peticio a cada tecla, sense cap espera.
 */

import { html, raw } from "hono/html";

import { Casella, Tria } from "../../components/form.tsx";
import { Paginacio, TaulaDades } from "../../components/vista.tsx";
import type { Cadence } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ComercVista, PaginaComercos } from "../../services/merchants.ts";
import { PER_PAGINA, type MerchantFilters } from "./merchants.schema.ts";

const dataCurta = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const CADENCIES: Record<Cadence, string> = {
  weekly: "setmanal",
  biweekly: "quinzenal",
  monthly: "mensual",
  bimonthly: "bimensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
};

export interface TaulaProps {
  codi: string;
  pagina: PaginaComercos;
  grups: GrupCategories[];
  filters: MerchantFilters;
  potEditar: boolean;
}

export function Taula({ codi, pagina, grups, filters, potEditar }: TaulaProps): Html {
  return html`<div id="taula-comercos">
    ${TaulaDades({
      columnes: html`<th>Comerç</th>
        <th>Categoria per defecte</th>
        <th>Recurrent</th>
        <th class="dreta">Moviments</th>
        <th>Vist per ultim cop</th>` as Html,
      files: pagina.items.map((comerc) => Fila({ codi, comerc, grups, potEditar })),
      buit: filters.cerca
        ? (html`No hi ha cap comerç que encaixi amb «${filters.cerca}».` as Html)
        : "Encara no hi ha cap comerç. N'apareixeran a mesura que s'importin moviments.",
      peu: Paginacio({ pagina, passos: Passos({ codi, filters, total: pagina.total }) }),
    })}
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
  const cadencia = comerc.recurrentCadence ?? "monthly";

  return html`<tr id="comerc-${comerc.id}">
    <td>
      <span class="nom">${comerc.displayName}</span>
      ${
        comerc.isConfirmed
          ? html`<span class="etiqueta" title="Ho ha confirmat una persona">confirmat</span>`
          : ""
      }
      ${
        comerc.isRecurrent
          ? html`<span class="etiqueta" title="Entra a la previsio de saldo">recurrent</span>`
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
              id: `categoria-comerc-${comerc.id}`,
              etiqueta: `Categoria de ${comerc.displayName}`,
              valor: comerc.defaultCategoryId,
              grups,
              buit: "— sense classificar —",
              // Assignar-la reescriu la categoria de tots els moviments del
              // comerç: mentre corre, el select no s'ha de poder tornar a
              // tocar.
              atributs: `hx-post="${base}/categoria" hx-target="#comerc-${comerc.id}" hx-swap="outerHTML" hx-trigger="change" hx-disabled-elt="this"`,
            })
          : (comerc.categoryName ?? html`<span class="text-suau">sense classificar</span>`)
      }
    </td>
    <td>
      ${
        potEditar
          ? html`<div class="recurrent-comerc" id="recurrent-comerc-${comerc.id}">
            <label class="casella">
              <input
                type="checkbox"
                name="is_recurrent"
                value="1"
                ${comerc.isRecurrent ? raw("checked") : ""}
                aria-label="Marca ${comerc.displayName} com a recurrent"
                hx-post="${base}/recurrent"
                hx-target="#comerc-${comerc.id}"
                hx-swap="outerHTML"
                hx-include="#recurrent-comerc-${comerc.id}"
              />
            </label>
            <select
              name="recurrent_cadence"
              aria-label="Cadencia de ${comerc.displayName}"
              ${comerc.isRecurrent ? "" : raw("disabled")}
              hx-post="${base}/recurrent"
              hx-target="#comerc-${comerc.id}"
              hx-swap="outerHTML"
              hx-include="#recurrent-comerc-${comerc.id}"
              hx-trigger="change"
            >
              ${Object.entries(CADENCIES).map(
                ([valor, etiqueta]) =>
                  html`<option value="${valor}" ${cadencia === valor ? raw("selected") : ""}>
                    ${etiqueta}
                  </option>`,
              )}
            </select>
          </div>`
          : comerc.isRecurrent
            ? html`${CADENCIES[cadencia]}`
            : html`<span class="text-suau">—</span>`
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

    ${Casella({
      nom: "sense_classificar",
      valor: "1",
      etiqueta: "Nomes els que no tenen categoria",
      marcat: filters.sense_classificar,
    })}

    ${Casella({
      nom: "sense_confirmar",
      valor: "1",
      etiqueta: "Nomes els que no ha confirmat ningu",
      marcat: filters.sense_confirmar,
    })}
  </form>` as Html;
}
