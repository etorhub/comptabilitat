/**
 * Fragments dels actors.
 */

import { html, raw } from "hono/html";

import { Tria } from "../../components/form.tsx";
import { Paginacio, TaulaDades } from "../../components/vista.tsx";
import type { ActorKind } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { ActorVista, PaginaActors } from "../../services/actors.ts";
import { PER_PAGINA, type ActorFilters } from "./actors.schema.ts";

const dataCurta = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const NOMS_KIND: Record<ActorKind, string> = {
  persona: "Persona",
  empresa: "Empresa",
  administracio: "Administracio",
  desconegut: "Desconegut",
};

export interface TaulaProps {
  codi: string;
  pagina: PaginaActors;
  usuaris: { id: number; fullName: string }[];
  /** Tots els actors de l'espai, per al selector de «fusiona amb» de cada fila. */
  tots: { id: number; displayName: string }[];
  filters: ActorFilters;
  potEditar: boolean;
}

export function Taula({ codi, pagina, usuaris, tots, filters, potEditar }: TaulaProps): Html {
  return html`<div id="taula-actors">
    ${TaulaDades({
      columnes: html`<th>Actor</th>
        <th>Mena</th>
        <th>Usuari lligat</th>
        <th class="dreta">Moviments</th>
        <th>Vist per ultim cop</th>` as Html,
      files: pagina.items.map((actor) =>
        Fila({
          codi,
          actor,
          usuaris,
          altres: tots.filter((a) => a.id !== actor.id),
          potEditar,
        }),
      ),
      buit: filters.cerca
        ? (html`No hi ha cap actor que encaixi amb «${filters.cerca}».` as Html)
        : "Encara no hi ha cap actor. N'apareixeran quan arribi una transferencia.",
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
  filters: ActorFilters;
  total: number;
}): Html {
  const ultima = Math.max(0, Math.ceil(total / PER_PAGINA) - 1);
  const enllac = (p: number) => {
    const params = new URLSearchParams();
    if (filters.cerca) params.set("cerca", filters.cerca);
    if (filters.sense_confirmar) params.set("sense_confirmar", "1");
    if (p > 0) params.set("pagina", String(p));
    return `/e/${codi}/actors/fragment/taula?${params.toString()}`;
  };

  return html`<span class="passos">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina - 1)}"
      hx-target="#taula-actors"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= ultima ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina + 1)}"
      hx-target="#taula-actors"
      hx-swap="outerHTML"
    >
      Següent
    </button>
  </span>` as Html;
}

export interface FilaProps {
  codi: string;
  actor: ActorVista;
  usuaris: { id: number; fullName: string }[];
  /** Els altres actors de l'espai, per fusionar-hi. Buit si no es dibuixa el selector. */
  altres: { id: number; displayName: string }[];
  potEditar: boolean;
}

export function Fila({ codi, actor, usuaris, altres, potEditar }: FilaProps): Html {
  const base = `/e/${codi}/actors/${actor.id}`;

  return html`<tr id="actor-${actor.id}">
    <td>
      <span class="nom">${actor.displayName}</span>
      ${
        actor.isConfirmed
          ? html`<span class="etiqueta" title="Ho ha confirmat una persona">confirmat</span>`
          : html`<span class="etiqueta etiqueta-suau" title="Encara ningu no l'ha confirmat"
              >sense confirmar</span
            >`
      }
      <br />
      <small class="text-suau">${actor.normalizedName}</small>
      ${
        potEditar
          ? html`<form
              class="linia linia-compacta"
              hx-post="${base}/confirma"
              hx-target="#actor-${actor.id}"
              hx-swap="outerHTML"
            >
              <input type="text" name="display_name" value="${actor.displayName}" maxlength="200" />
              ${Tria({
                nom: "kind",
                id: `kind-${actor.id}`,
                etiqueta: `Mena de ${actor.displayName}`,
                valor: actor.kind,
                opcions: Object.entries(NOMS_KIND).map(([valor, text]) => ({ valor, text })),
              })}
              <button type="submit" class="boto boto-discret">Confirma</button>
            </form>`
          : ""
      }
      ${
        potEditar && altres.length > 0
          ? html`<form
              class="linia linia-compacta"
              hx-post="${base}/fusiona"
              hx-target="#taula-actors"
              hx-swap="outerHTML"
              hx-confirm="Segur que vols fusionar «${actor.displayName}» amb l'actor triat? Els seus moviments i alies hi passaran, i «${actor.displayName}» desapareixera."
            >
              ${Tria({
                nom: "altre_id",
                id: `fusiona-${actor.id}`,
                etiqueta: `Fusiona ${actor.displayName} amb`,
                grups: [
                  {
                    etiqueta: "Altres actors",
                    opcions: altres.map((a) => ({ valor: a.id, text: a.displayName })),
                  },
                ],
                buit: "— fusiona amb —",
              })}
              <button type="submit" class="boto boto-discret boto-perill">Fusiona</button>
            </form>`
          : ""
      }
    </td>
    <td>${NOMS_KIND[actor.kind]}</td>
    <td>
      ${
        potEditar
          ? Tria({
              nom: "user_id",
              id: `usuari-${actor.id}`,
              etiqueta: `Usuari lligat a ${actor.displayName}`,
              valor: actor.userId,
              opcions: usuaris.map((u) => ({ valor: u.id, text: u.fullName })),
              buit: "— cap —",
              atributs: `hx-post="${base}/usuari" hx-target="#actor-${actor.id}" hx-swap="outerHTML" hx-trigger="change"`,
            })
          : (actor.userName ?? html`<span class="text-suau">—</span>`)
      }
    </td>
    <td class="dreta">${String(actor.transactionCount)}</td>
    <td>
      ${
        actor.lastSeenAt
          ? dataCurta.format(new Date(`${actor.lastSeenAt}T00:00:00`))
          : html`<span class="text-suau">—</span>`
      }
    </td>
  </tr>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: ActorFilters;
}

export function BarraFiltres({ codi, filters }: BarraFiltresProps): Html {
  return html`<form
    class="filtres superficie targeta"
    hx-get="/e/${codi}/actors/fragment/taula"
    hx-target="#taula-actors"
    hx-swap="outerHTML"
    hx-trigger="change, keyup changed delay:300ms from:input[name='cerca']"
  >
    <label class="camp camp-linia">
      <span class="camp-etiqueta">Cerca</span>
      <input
        type="search"
        name="cerca"
        value="${filters.cerca}"
        placeholder="Nom de l'actor"
        autocomplete="off"
      />
    </label>
    <label class="casella">
      <input type="checkbox" name="sense_confirmar" value="1" ${filters.sense_confirmar ? raw("checked") : ""} />
      <span>Nomes sense confirmar</span>
    </label>
  </form>` as Html;
}
