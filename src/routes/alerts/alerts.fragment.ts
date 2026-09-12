/**
 * Fragments dels avisos.
 *
 * `LlistaAvisos` es el que torna tant la pagina sencera (a dins) com la ruta
 * de fragment i les mutacions. Aixi no hi ha dues maneres de dibuixar una
 * llista d'avisos que puguin acabar diferint.
 */

import { html } from "hono/html";

import type { Alert, AlertSeverity } from "../../db/schema/index.ts";
import { Checkbox } from "../../components/form.ts";
import { EmptyState } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { alertFiltersToQuery, type AlertFilters } from "./alerts.schema.ts";

const GRAVETAT: Record<AlertSeverity, { tag: string; cssClass: string }> = {
  critical: { tag: "Urgent", cssClass: "avis-critic" },
  warning: { tag: "Atencio", cssClass: "avis-atencio" },
  info: { tag: "Informatiu", cssClass: "avis-info" },
};

const dateLlarga = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export interface AlertsListProps {
  codi: string;
  alertList: Alert[];
  filters: AlertFilters;
}

export function AlertsList({ codi, alertList, filters }: AlertsListProps): Html {
  return html`<div id="llista-avisos">
    ${
      alertList.length === 0
        ? EmptyState(
            filters.descartats
              ? "Aqui no hi ha cap avis."
              : "Cap avis pendent. Quan n'hi hagi, sortiran aqui.",
          )
        : html`<ul class="avisos">
          ${alertList.map((alert) => AlertCard({ codi, alert, filters }))}
        </ul>`
    }
  </div>` as Html;
}

interface AlertCardProps {
  codi: string;
  alert: Alert;
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

export function AlertCard({ codi, alert, filters }: AlertCardProps): Html {
  const query = filters === undefined ? "" : alertFiltersToQuery(filters);
  const gravetat = GRAVETAT[alert.severity];
  const dismissed = alert.status === "dismissed";

  return html`<li
    id="avis-${alert.id}"
    class="avis ${gravetat.cssClass} ${alert.status === "new" ? "avis-nou" : ""}"
  >
    <div class="avis-cap">
      <span class="etiqueta">${gravetat.tag}</span>
      <h2 class="avis-titol">${alert.title}</h2>
      <time class="text-suau" datetime="${alert.createdAt.toISOString()}">
        ${dateLlarga.format(alert.createdAt)}
      </time>
    </div>

    ${alert.body ? html`<p class="avis-cos">${alert.body}</p>` : ""}

    <div class="avis-accions">
      ${
        dismissed
          ? html`<span class="text-suau">Descartat</span>`
          : html`
            ${
              alert.status === "new"
                ? html`<button
                  type="button"
                  class="boto boto-discret"
                  hx-post="/e/${codi}/avisos/${alert.id}/llegit${query}"
                  hx-target="#avis-${alert.id}"
                  hx-swap="outerHTML"
                >
                  Marca'l com a llegit
                </button>`
                : ""
            }
            <button
              type="button"
              class="boto boto-discret"
              hx-post="/e/${codi}/avisos/${alert.id}/descarta${query}"
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
export function DismissedAlert(id: number): Html {
  return html`<li id="avis-${id}" class="avis-fora" hidden></li>` as Html;
}

export interface FilterBarProps {
  codi: string;
  filters: AlertFilters;
}

/**
 * El filtre viu a la cadena de consulta de la **pagina**, no en cap estat de
 * client: la ruta de fragment llegeix els mateixos paràmetres i el servidor
 * torna `HX-Push-Url` amb l'adreça canonica, de manera que l'enllaç es pot
 * compartir i el boto d'enrere funciona.
 */
export function FilterBar({ codi, filters }: FilterBarProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${codi}/avisos/fragment/llista"
    hx-target="#llista-avisos"
    hx-swap="outerHTML"
    hx-trigger="change"
  >
    ${Checkbox({
      name: "descartats",
      valor: "1",
      tag: "Inclou els descartats",
      marcat: filters.descartats,
    })}
  </form>` as Html;
}
