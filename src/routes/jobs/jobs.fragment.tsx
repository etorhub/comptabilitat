/**
 * Fragments de la pagina de feines.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { FeinaId } from "./jobs.schema.ts";

export interface EntradaFeina {
  id: FeinaId;
  titol: string;
  descripcio: string;
}

export function BotoFeina({ id, titol, descripcio }: EntradaFeina): Html {
  return html`<div class="superficie targeta">
    <div class="item-cap">
      <div>
        <strong>${titol}</strong>
        <p class="text-suau">${descripcio}</p>
      </div>
      <form hx-post="/feines" hx-swap="none">
        <input type="hidden" name="feina" value="${id}" />
        <button type="submit" class="boto">Executa</button>
      </form>
    </div>
  </div>` as Html;
}

export function LlistaFeines({
  passades,
  individuals,
}: {
  passades: EntradaFeina[];
  individuals: EntradaFeina[];
}): Html {
  return html`<div id="llista-feines">
    <section>
      <h2 class="menu-titol">Passades</h2>
      ${passades.map((feina) => BotoFeina(feina))}
    </section>
    <section>
      <h2 class="menu-titol">Feines</h2>
      ${individuals.map((feina) => BotoFeina(feina))}
    </section>
  </div>` as Html;
}
