/**
 * Pagina de feines del planificador i del seu historial.
 */

import { html } from "hono/html";

import type { JobRun } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { PaginaHistorial, ResumSalut } from "../../services/job-runs.ts";
import {
  AgendaSalut,
  EnCurs,
  entradesAgenda,
  type EntradaFeina,
  LlistaFeines,
  LlistaHistorial,
} from "./jobs.fragment.ts";
import type { HistorialFilters } from "./jobs.schema.ts";

export interface JobsPageProps {
  passades: EntradaFeina[];
  individuals: EntradaFeina[];
  darreres: Map<string, JobRun>;
  enCursRuns: JobRun[];
  enCursNoms: Set<string>;
  salut: ResumSalut;
  historial: PaginaHistorial;
  filters: HistorialFilters;
}

export function JobsPage(props: JobsPageProps): Html {
  const { passades, individuals, darreres, enCursRuns, enCursNoms, salut, historial, filters } =
    props;

  return html`
    <header class="capçalera">
      <h1>Feines</h1>
      <p class="text-suau">
        Les mateixes feines que el planificador i que
        <code>bun run jobs …</code>. Aqui pots engegar-les a ma i veure cada
        execució: horaris, durada, errors i resultats.
      </p>
    </header>

    ${AgendaSalut({ entrades: entradesAgenda(darreres), salut })}
    ${EnCurs({ runs: enCursRuns })}
    ${LlistaFeines({ passades, individuals, darreres, enCurs: enCursNoms })}

    <section>
      <h2 class="menu-titol">Historial</h2>
      ${LlistaHistorial({ pagina: historial, filters })}
    </section>

    <section>
      <h2 class="menu-titol">Detall</h2>
      <div id="detall-execucio">
        <p class="text-suau">Tria una execució de l'historial per veure'n el resum sencer.</p>
      </div>
    </section>
  ` as Html;
}
