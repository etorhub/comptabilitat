/**
 * Page of scheduler jobs and their history.
 */

import { html } from "hono/html";

import type { JobRun } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { HistoryPage, HealthSummary } from "../../services/job-runs.ts";
import {
  ScheduleHealth,
  Running,
  scheduleEntries,
  type JobEntry,
  JobsList,
  HistoryList,
} from "./jobs.fragment.ts";
import type { HistoryFilters } from "./jobs.schema.ts";

export interface JobsPageProps {
  passes: JobEntry[];
  individuals: JobEntry[];
  latest: Map<string, JobRun>;
  runningJobs: JobRun[];
  runningNames: Set<string>;
  health: HealthSummary;
  history: HistoryPage;
  filters: HistoryFilters;
}

export function JobsPage(props: JobsPageProps): Html {
  const { passes, individuals, latest, runningJobs, runningNames, health, history, filters } =
    props;
  const entries = scheduleEntries(latest);

  return html`
    <header class="capçalera">
      <h1>Tasques</h1>
      <p class="text-suau">
        Les mateixes tasques que el planificador i que
        <code>bun run jobs …</code>. Aqui pots engegar-les a ma i veure cada
        execució: horaris, durada, errors i resultats.
      </p>
    </header>

    <section class="feines-zona superficie targeta">
      <h2 class="menu-titol">Estat</h2>
      ${ScheduleHealth({ health })}
      ${Running({ runs: runningJobs })}
    </section>

    <section class="feines-zona">
      <h2 class="menu-titol">Engegar</h2>
      ${JobsList({ passes, individuals, latest, running: runningNames, entries })}
    </section>

    <section class="feines-zona">
      <h2 class="menu-titol">Registre</h2>
      <div class="dues-columnes feines-registre">
        <div>
          <h3 class="menu-titol">Historial</h3>
          ${HistoryList({ page: history, filters })}
        </div>
        <div>
          <h3 class="menu-titol">Detall</h3>
          <div id="detall-execucio">
            <p class="text-suau">Tria una execució de l'historial per veure'n el resum sencer.</p>
          </div>
        </div>
      </div>
    </section>
  ` as Html;
}
