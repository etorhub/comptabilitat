/**
 * Alert fragments.
 *
 * `AlertsList` is what both the whole page (inside it) and the fragment route
 * and the mutations return. That way there are not two ways of drawing a list
 * of alerts that could end up differing.
 */

import { html } from "hono/html";

import type { Alert, AlertSeverity } from "../../db/schema/index.ts";
import { Checkbox } from "../../components/form.ts";
import { EmptyState } from "../../components/views.ts";
import type { Html } from "../../lib/html.ts";
import { alertFiltersToQuery, type AlertFilters } from "./alerts.schema.ts";

const SEVERITY: Record<AlertSeverity, { tag: string; cssClass: string }> = {
  critical: { tag: "Urgent", cssClass: "avis-critic" },
  warning: { tag: "Atencio", cssClass: "avis-atencio" },
  info: { tag: "Informatiu", cssClass: "avis-info" },
};

const dateLong = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export interface AlertsListProps {
  code: string;
  alertList: Alert[];
  filters: AlertFilters;
}

export function AlertsList({ code, alertList, filters }: AlertsListProps): Html {
  return html`<div id="llista-avisos">
    ${
      alertList.length === 0
        ? EmptyState(
            filters.descartats
              ? "Aqui no hi ha cap avis."
              : "Cap avis pendent. Quan n'hi hagi, sortiran aqui.",
          )
        : html`<ul class="avisos">
          ${alertList.map((alert) => AlertCard({ code, alert, filters }))}
        </ul>`
    }
  </div>` as Html;
}

interface AlertCardProps {
  code: string;
  alert: Alert;
  /**
   * The filters of the list the card lives in.
   *
   * Dismissing one returns the whole list, and without this it would return
   * the *default* list: whoever was looking at the dismissed ones would see
   * them all disappear at once. They go in the URL and not in an `hx-include`
   * because the button is not inside any form.
   */
  filters?: AlertFilters;
}

export function AlertCard({ code, alert, filters }: AlertCardProps): Html {
  const query = filters === undefined ? "" : alertFiltersToQuery(filters);
  const severity = SEVERITY[alert.severity];
  const dismissed = alert.status === "dismissed";

  return html`<li
    id="avis-${alert.id}"
    class="avis ${severity.cssClass} ${alert.status === "new" ? "avis-nou" : ""}"
  >
    <div class="avis-cap">
      <span class="etiqueta">${severity.tag}</span>
      <h2 class="avis-titol">${alert.title}</h2>
      <time class="text-suau" datetime="${alert.createdAt.toISOString()}">
        ${dateLong.format(alert.createdAt)}
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
                  hx-post="/e/${code}/avisos/${alert.id}/llegit${query}"
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
              hx-post="/e/${code}/avisos/${alert.id}/descarta${query}"
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
 * A dismissed alert disappears from the list.
 *
 * An empty node with the same id is returned so that the `outerHTML` swap has
 * somewhere to go; if we returned an empty string, HTMX would not know what
 * to remove.
 */
export function DismissedAlert(id: number): Html {
  return html`<li id="avis-${id}" class="avis-fora" hidden></li>` as Html;
}

export interface FilterBarProps {
  code: string;
  filters: AlertFilters;
}

/**
 * The filter lives in the **page's** query string, not in any client state:
 * the fragment route reads the same parameters and the server returns
 * `HX-Push-Url` with the canonical URL, so the link can be shared and the
 * back button works.
 */
export function FilterBar({ code, filters }: FilterBarProps): Html {
  return html`<form
    class="filtres"
    hx-get="/e/${code}/avisos/fragment/llista"
    hx-target="#llista-avisos"
    hx-swap="outerHTML"
    hx-trigger="change"
  >
    ${Checkbox({
      name: "descartats",
      value: "1",
      tag: "Inclou els descartats",
      marked: filters.descartats,
    })}
  </form>` as Html;
}
