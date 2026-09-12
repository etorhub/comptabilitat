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

  return html`
    <header class="capçalera">
      <h1>Feines</h1>
      <p class="text-suau">
        Les mateixes feines que el planificador i que
        <code>bun run jobs …</code>. Aqui pots engegar-les a ma i veure cada
        execució: horaris, durada, errors i resultats.
      </p>
    </header>

    ${ScheduleHealth({ entries: scheduleEntries(latest), health })}
    ${Running({ runs: runningJobs })}
    ${JobsList({ passes, individuals, latest, running: runningNames })}

    <section>
      <h2 class="menu-titol">Historial</h2>
      ${HistoryList({ page: history, filters })}
    </section>

    <section>
      <h2 class="menu-titol">Detall</h2>
      <div id="detall-execucio">
        <p class="text-suau">Tria una execució de l'historial per veure'n el resum sencer.</p>
      </div>
    </section>
  ` as Html;
}
