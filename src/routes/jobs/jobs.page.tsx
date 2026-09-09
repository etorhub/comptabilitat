/**
 * Pagina de feines del planificador.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { LlistaFeines, type EntradaFeina } from "./jobs.fragment.tsx";

export interface JobsPageProps {
  passades: EntradaFeina[];
  individuals: EntradaFeina[];
}

export function JobsPage({ passades, individuals }: JobsPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Feines</h1>
      <p class="text-suau">
        Les mateixes feines que el planificador i que
        <code>bun run jobs …</code>. Corre'n una a ma quan calgui; el resultat
        surt al registre del servidor.
      </p>
    </header>

    ${LlistaFeines({ passades, individuals })}
  ` as Html;
}
