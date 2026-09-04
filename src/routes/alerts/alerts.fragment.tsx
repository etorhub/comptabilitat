/**
 * Fragments dels avisos.
 *
 * `LlistaAvisos` es el que torna tant la pagina sencera (a dins) com la ruta
 * de fragment i les mutacions. Aixi no hi ha dues maneres de dibuixar una
 * llista d'avisos que puguin acabar diferint.
 */

import { html } from "hono/html";

import type { Alert, AlertSeverity } from "../../db/schema/index.ts";
import { Casella } from "../../components/form.tsx";
import { EstatBuit } from "../../components/vista.tsx";
import type { Html } from "../../lib/html.ts";
import { alertFiltersToQuery, type AlertFilters } from "./alerts.schema.ts";

const GRAVETAT: Record<AlertSeverity, { etiqueta: string; classe: string }> = {
  critical: { etiqueta: "Urgent", classe: "avis-critic" },
  warning: { etiqueta: "Atencio", classe: "avis-atencio" },
  info: { etiqueta: "Informatiu", classe: "avis-info" },
};

const dataLlarga = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export interface LlistaAvisosProps {
  codi: string;
  avisos: Alert[];
  filters: AlertFilters;
}

export function LlistaAvisos({ codi, avisos, filters }: LlistaAvisosProps): Html {
  return html`<div id="llista-avisos">
    ${
      avisos.length === 0
        ? EstatBuit(
            filters.descartats
              ? "Aqui no hi ha cap avis."
              : "Cap avis pendent. Quan n'hi hagi, sortiran aqui.",
          )
        : html`<ul class="avisos">
          ${avisos.map((avis) => TargetaAvis({ codi, avis, filters }))}
        </ul>`
    }
  </div>` as Html;
}

interface TargetaAvisProps {
  codi: string;
  avis: Alert;
  /**
   * Els filtres de la llista on viu la targeta.
   *
   * Descartar-ne un torna la llista sencera, i sense aixo tornaria la llista
   * *per defecte*: qui estigues mirant els descartats els veuria desapareixer
   * tots de cop. Van a l'adreça i no a un `hx-include` perque el boto no es
   * dins de cap formulari.
   */
  filters?: AlertFilters;
}

export function TargetaAvis({ codi, avis, filters }: TargetaAvisProps): Html {
  const consulta = filters === undefined ? "" : alertFiltersToQuery(filters);
  const gravetat = GRAVETAT[avis.severity];
  const descartat = avis.status === "dismissed";

  return html`<li
    id="avis-${avis.id}"
    class="avis ${gravetat.classe} ${avis.status === "new" ? "avis-nou" : ""}"
  >
    <div class="avis-cap">
      <span class="etiqueta">${gravetat.etiqueta}</span>
      <h2 class="avis-titol">${avis.title}</h2>
      <time class="text-suau" datetime="${avis.createdAt.toISOString()}">
        ${dataLlarga.format(avis.createdAt)}
      </time>
    </div>

    ${avis.body ? html`<p class="avis-cos">${avis.body}</p>` : ""}

    <div class="avis-accions">
      ${
        descartat
          ? html`<span class="text-suau">Descartat</span>`
          : html`
            ${
              avis.status === "new"
                ? html`<button
                  type="button"
                  class="boto boto-discret"
                  hx-post="/e/${codi}/avisos/${avis.id}/llegit${consulta}"
                  hx-target="#avis-${avis.id}"
                  hx-swap="outerHTML"
                >
                  Marca'l com a llegit
                </button>`
                : ""
            }
            <button
              type="button"
              class="boto boto-discret"
              hx-post="/e/${codi}/avisos/${avis.id}/descarta${consulta}"
              hx-target="#llista-avisos"
              hx-swap="outerHTML"
            >
              Descarta
            </button>
          `
      }
    </div>
  </li>` as Html;
}

/**
 * Un avis descartat desapareix de la llista.
 *
 * Es torna un node buit amb el mateix identificador perque l'intercanvi
 * `outerHTML` tingui on anar; si tornessim una cadena buida, HTMX no sabria
 * que treure.
 */
export function AvisDescartat(id: number): Html {
  return html`<li id="avis-${id}" class="avis-fora" hidden></li>` as Html;
}

export interface BarraFiltresProps {
  codi: string;
  filters: AlertFilters;
}

/**
 * El filtre viu a la cadena de consulta de la **pagina**, no en cap estat de
 * client: la ruta de fragment llegeix els mateixos paràmetres i el servidor
 * torna `HX-Push-Url` amb l'adreça canonica, de manera que l'enllaç es pot
 * compartir i el boto d'enrere funciona.
 */
export function BarraFiltres({ codi, filters }: BarraFiltresProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${codi}/avisos/fragment/llista"
    hx-target="#llista-avisos"
    hx-swap="outerHTML"
    hx-trigger="change"
  >
    ${Casella({
      nom: "descartats",
      valor: "1",
      etiqueta: "Inclou els descartats",
      marcat: filters.descartats,
    })}
  </form>` as Html;
}
