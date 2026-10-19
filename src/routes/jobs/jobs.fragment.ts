/**
 * Fragments of the jobs page.
 *
 * `HistoryList` and `Running` are returned both from the page and from the
 * fragment routes and the mutations. The poll in `Running` is the same
 * exception documented in AGENTS.md as the connections one: it stops by
 * itself when there is no `running` job left.
 */

import { html, raw } from "hono/html";

import { Field, Select } from "../../components/form.ts";
import { DataTable } from "../../components/views.ts";
import type { JobRun, JobStatus, SyncRun } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import type { Html } from "../../lib/html.ts";
import type { HistoryPage, HealthSummary } from "../../services/job-runs.ts";
import { oobAttributes } from "../../lib/oob.ts";
import { poll, pollExhausted } from "../../lib/polling.ts";
import {
  STATUS_LABELS,
  JOB_LABELS,
  TRIGGER_LABELS,
  type JobId,
  JOBS,
  type HistoryFilters,
  historyFiltersToQuery,
  PASSES_CONTAINING,
  PIPELINE_STEPS,
} from "./jobs.schema.ts";

export interface JobEntry {
  id: JobId;
  title: string;
  description: string;
}

const dateTime = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: config.timezone,
});

const dateShort = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: config.timezone,
});

function jobLabel(name: string): string {
  return JOB_LABELS[name as JobId] ?? name;
}

function stateClass(status: JobStatus): string {
  switch (status) {
    case "failed":
      return "etiqueta etiqueta-perill";
    case "running":
      return "etiqueta";
    case "partial":
      return "etiqueta etiqueta-parcial";
    default:
      return "etiqueta etiqueta-suau";
  }
}

function duration(run: JobRun): string {
  const fi = run.finishedAt?.getTime() ?? Date.now();
  const seconds = Math.max(0, Math.round((fi - run.startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (min < 60) return rest === 0 ? `${min} min` : `${min} min ${rest}s`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

function excerpt(text: string, max = 120): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Steps shown on a pass card; skips the nightly pass when Ollama is off. */
function staticSteps(id: JobId): JobId[] {
  const steps = PIPELINE_STEPS[id] ?? [];
  if (id === "totes" && !config.ollamaEnabled) {
    return steps.filter((s) => s !== "passada-nocturna");
  }
  return [...steps];
}

/**
 * Horizontal pipeline of steps. Static (planned order) or live (runs with
 * status). Nested children of a nested pass render as a sub-chain.
 */
export function PipelineDiagram({
  steps,
  runs,
  nested,
  compact = false,
}: {
  steps?: readonly JobId[];
  runs?: JobRun[];
  nested?: Map<number, JobRun[]>;
  compact?: boolean;
}): Html {
  if (runs && runs.length > 0) {
    return html`<ol class="feines-pipeline ${compact ? "feines-pipeline-compacta" : ""}">
      ${runs.map((run, i) => {
        const kids = nested?.get(run.id) ?? [];
        return html`<li class="feines-pipeline-pas">
          ${i > 0 ? html`<span class="feines-pipeline-fletxa" aria-hidden="true">→</span>` : ""}
          <div class="feines-pipeline-node">
            <span class="${stateClass(run.status)}">${STATUS_LABELS[run.status]}</span>
            <strong>${jobLabel(run.jobName)}</strong>
            <span class="text-suau">${duration(run)}</span>
            ${kids.length > 0 ? PipelineDiagram({ runs: kids, compact: true }) : ""}
          </div>
        </li>`;
      })}
    </ol>` as Html;
  }

  const ids = steps ?? [];
  if (ids.length === 0) return html`` as Html;

  return html`<ol class="feines-pipeline ${compact ? "feines-pipeline-compacta" : ""}">
    ${ids.map((id, i) => {
      const sub = staticSteps(id);
      return html`<li class="feines-pipeline-pas">
        ${i > 0 ? html`<span class="feines-pipeline-fletxa" aria-hidden="true">→</span>` : ""}
        <div class="feines-pipeline-node">
          <strong>${jobLabel(id)}</strong>
          ${sub.length > 0 ? PipelineDiagram({ steps: sub, compact: true }) : ""}
        </div>
      </li>`;
    })}
  </ol>` as Html;
}

export interface ScheduleEntry {
  id: JobId;
  title: string;
  time: string;
  last: JobRun | null;
}

/** Health counters only; agenda lives under Engegar with the launch list. */
export function ScheduleHealth({
  health,
  oob = false,
}: {
  health: HealthSummary;
  oob?: boolean;
}): Html {
  const pass = health.lastDailyPass;
  return html`<div ${oobAttributes("agenda-salut", oob)} class="feines-estat-salut">
    <div class="feines-comptadors">
      <p>
        <strong>${String(health.running)}</strong>
        <span class="text-suau">en curs</span>
      </p>
      <p>
        <strong>${String(health.failed24h)}</strong>
        <span class="text-suau">fallades (24 h)</span>
      </p>
      <p>
        <span class="text-suau">Darrera passada diaria:</span>
        ${
          pass
            ? html`<span class="${stateClass(pass.status)}">${STATUS_LABELS[pass.status]}</span>
              <time class="text-suau" datetime="${pass.startedAt.toISOString()}">
                ${dateShort.format(pass.startedAt)}
              </time>`
            : html`<span class="text-suau">encara no n'hi ha</span>`
        }
      </p>
    </div>
  </div>` as Html;
}

export function AgendaList({ entries }: { entries: ScheduleEntry[] }): Html {
  return html`<ul class="feines-agenda">
    ${entries.map(
      (e) => html`<li>
        <strong>${e.title}</strong>
        <span class="text-suau">${e.time}</span>
        ${
          e.last
            ? html`<span class="${stateClass(e.last.status)}">${STATUS_LABELS[e.last.status]}</span>
              <span class="text-suau">${duration(e.last)}</span>`
            : html`<span class="text-suau">—</span>`
        }
      </li>`,
    )}
  </ul>` as Html;
}

function buttonBlocked(id: JobId, running: Set<string>): boolean {
  if (running.has(id)) return true;
  for (const pass of PASSES_CONTAINING[id] ?? []) {
    if (running.has(pass)) return true;
  }
  // If a step this pass would include is running, do not start it again.
  if (id === "passada-diaria" || id === "totes") {
    for (const step of ["sync", "classify", "analyze"] as const) {
      if (running.has(step)) return true;
    }
  }
  if (id === "passada-nocturna" || id === "totes") {
    for (const step of ["llm", "classify"] as const) {
      if (running.has(step)) return true;
    }
  }
  if (id === "totes") {
    for (const step of [
      "notify",
      "maintenance",
      "passada-diaria",
      "passada-nocturna",
    ] as const) {
      if (running.has(step)) return true;
    }
  }
  return false;
}

function ExecutaForm({ id, blocked }: { id: JobId; blocked: boolean }): Html {
  return html`<form
    hx-post="/feines"
    hx-swap="none"
    hx-disabled-elt="find button"
  >
    <input type="hidden" name="feina" value="${id}" />
    <button type="submit" class="boto" ${blocked ? raw("disabled") : ""}>
      ${blocked ? "En curs…" : "Executa"}
    </button>
  </form>` as Html;
}

export function ButtonPass({
  id,
  title,
  description,
  last,
  running,
}: JobEntry & { last: JobRun | null; running: Set<string> }): Html {
  const blocked = buttonBlocked(id, running);
  const steps = staticSteps(id);
  return html`<div class="superficie targeta feines-passada">
    <div class="item-cap feines-item-cap">
      <div>
        <strong>${title}</strong>
        ${
          last
            ? html`<span class="${stateClass(last.status)}">${STATUS_LABELS[last.status]}</span>
              <span class="text-suau">${dateShort.format(last.startedAt)} · ${duration(last)}</span>`
            : html`<span class="etiqueta etiqueta-suau">Mai</span>`
        }
        <p class="text-suau">${description}</p>
      </div>
      ${ExecutaForm({ id, blocked })}
    </div>
    ${steps.length > 0 ? PipelineDiagram({ steps }) : ""}
  </div>` as Html;
}

export function ButtonJob({
  id,
  title,
  description,
  last,
  running,
}: JobEntry & { last: JobRun | null; running: Set<string> }): Html {
  const blocked = buttonBlocked(id, running);
  return html`<li class="feines-feina">
    <div>
      <strong>${title}</strong>
      ${
        last
          ? html`<span class="${stateClass(last.status)}">${STATUS_LABELS[last.status]}</span>
            <span class="text-suau">${dateShort.format(last.startedAt)} · ${duration(last)}</span>`
          : html`<span class="etiqueta etiqueta-suau">Mai</span>`
      }
      <p class="text-suau">${description}</p>
    </div>
    ${ExecutaForm({ id, blocked })}
  </li>` as Html;
}

export function JobsList({
  passes,
  individuals,
  latest,
  running,
  entries,
  oob = false,
}: {
  passes: JobEntry[];
  individuals: JobEntry[];
  latest: Map<string, JobRun>;
  running: Set<string>;
  entries: ScheduleEntry[];
  oob?: boolean;
}): Html {
  return html`<div ${oobAttributes("llista-feines", oob)}>
    <section class="feines-bloc">
      <h3 class="menu-titol">Agenda</h3>
      ${AgendaList({ entries })}
    </section>
    <section class="feines-bloc">
      <h3 class="menu-titol">Passades</h3>
      ${passes.map((job) =>
        ButtonPass({
          ...job,
          last: latest.get(job.id) ?? null,
          running,
        }),
      )}
    </section>
    <section class="feines-bloc">
      <h3 class="menu-titol">Tasques</h3>
      <ul class="feines-llista">
        ${individuals.map((job) =>
          ButtonJob({
            ...job,
            last: latest.get(job.id) ?? null,
            running,
          }),
        )}
      </ul>
    </section>
  </div>` as Html;
}

/**
 * Top-level jobs still running.
 *
 * **A poll, with a limit.** While there are any, the fragment asks for the
 * next attempt; when the job finishes, the new fragment no longer carries a
 * trigger and HTMX stops. And if it never finishes —a process that dies
 * halfway leaves the row `running` forever— the attempt count runs out and
 * says so, instead of asking indefinitely. See `lib/polling.ts`.
 */
export function Running({
  runs,
  attempt = 0,
  oob = false,
}: {
  runs: JobRun[];
  attempt?: number;
  oob?: boolean;
}): Html {
  const running = runs.length > 0;
  const exhausted = running && pollExhausted(attempt);
  return html`<div
    ${oobAttributes("en-curs", oob)}
    class="feines-en-curs-bloc"
    ${running ? poll({ url: "/feines/fragment/en-curs", target: "#en-curs", attempt }) : ""}
    role="status"
    aria-live="polite"
  >
    ${
      exhausted
        ? html`<p class="text-suau">
          Fa massa estona que dura; s'ha deixat de comprovar.
          <a href="/feines">Torna-ho a mirar</a>.
        </p>`
        : ""
    }
    ${
      running
        ? html`<ul class="feines-en-curs">
          ${runs.map(
            (run) => html`<li>
              <span class="filador" aria-hidden="true"></span>
              <strong>${jobLabel(run.jobName)}</strong>
              <span class="etiqueta">${TRIGGER_LABELS[run.trigger]}</span>
              <time class="text-suau" datetime="${run.startedAt.toISOString()}">
                des de ${dateTime.format(run.startedAt)} · ${duration(run)}
              </time>
            </li>`,
          )}
        </ul>`
        : html`<p class="text-suau">Cap tasca corrent ara mateix.</p>`
    }
  </div>` as Html;
}

export function HistoryFilterBar({ filters }: { filters: HistoryFilters }): Html {
  const jobOptions = JOBS.map((id) => ({ value: id, text: JOB_LABELS[id] }));
  return html`<form
    class="filtres"
    hx-get="/feines/fragment/historial"
    hx-target="#historial-feines"
    hx-swap="outerHTML"
    hx-trigger="change, submit"
  >
    ${Select({
      name: "feina",
      tag: "Tasca",
      value: filters.feina ?? "",
      empty: "Totes",
      options: jobOptions,
    })}
    ${Select({
      name: "estat",
      tag: "Estat",
      value: filters.estat ?? "",
      empty: "Tots",
      options: [
        { value: "running", text: "En curs" },
        { value: "success", text: "Fet" },
        { value: "partial", text: "Parcial" },
        { value: "failed", text: "Ha fallat" },
      ],
    })}
    ${Select({
      name: "origen",
      tag: "Origen",
      value: filters.origen ?? "",
      empty: "Tots",
      options: [
        { value: "scheduled", text: "Cron" },
        { value: "manual", text: "UI" },
        { value: "cli", text: "CLI" },
      ],
    })}
    ${Field({
      name: "des_de",
      tag: "Des de",
      type: "date",
      value: filters.des_de ?? "",
    })}
    ${Field({
      name: "fins_a",
      tag: "Fins a",
      type: "date",
      value: filters.fins_a ?? "",
    })}
  </form>` as Html;
}

function RunRow(run: JobRun, children: JobRun[]): Html {
  const summary = run.error || run.summary;
  return html`<tr>
    <td>
      <a
        href="/feines#execucio-${run.id}"
        hx-get="/feines/fragment/execucio/${run.id}"
        hx-target="#detall-execucio"
        hx-swap="innerHTML"
      >
        ${jobLabel(run.jobName)}
      </a>
      ${
        children.length > 0
          ? html`<details class="feines-fills">
            <summary class="text-suau">${String(children.length)} passos</summary>
            ${PipelineDiagram({ runs: children, compact: true })}
          </details>`
          : ""
      }
    </td>
    <td><span class="etiqueta etiqueta-suau">${TRIGGER_LABELS[run.trigger]}</span></td>
    <td><span class="${stateClass(run.status)}">${STATUS_LABELS[run.status]}</span></td>
    <td>
      <time datetime="${run.startedAt.toISOString()}">${dateTime.format(run.startedAt)}</time>
    </td>
    <td>${duration(run)}</td>
    <td class="${run.status === "failed" ? "negatiu" : "text-suau"}">
      ${summary ? excerpt(summary) : "—"}
    </td>
  </tr>` as Html;
}

function HistorySteps({ filters, total }: { filters: HistoryFilters; total: number }): Html {
  const limit = 30;
  const last = Math.max(0, Math.ceil(total / limit) - 1);
  const link = (p: number) =>
    `/feines/fragment/historial${historyFiltersToQuery({ ...filters, pagina: p })}`;

  return html`<nav class="paginacio" aria-label="Paginacio">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${link(filters.pagina - 1)}"
      hx-target="#historial-feines"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <span class="text-suau">
      Pagina ${String(filters.pagina + 1)} de ${String(last + 1)}
    </span>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= last ? raw("disabled") : ""}
      hx-get="${link(filters.pagina + 1)}"
      hx-target="#historial-feines"
      hx-swap="outerHTML"
    >
      Seguent
    </button>
  </nav>` as Html;
}

export function HistoryList({
  page,
  filters,
  oob = false,
}: {
  page: HistoryPage;
  filters: HistoryFilters;
  oob?: boolean;
}): Html {
  const from = page.total === 0 ? 0 : page.page * page.limit + 1;
  const to = Math.min((page.page + 1) * page.limit, page.total);

  return html`<div ${oobAttributes("historial-feines", oob)}>
    ${HistoryFilterBar({ filters })}
    ${DataTable({
      columns:
        html`<th>Tasca</th><th>Origen</th><th>Estat</th><th>Inici</th><th>Durada</th><th>Resultat</th>` as Html,
      rows: page.items.map((run) => RunRow(run, page.children.get(run.id) ?? [])),
      empty: "Encara no hi ha cap execució registrada.",
      footer:
        page.total > 0
          ? (html`<p class="text-suau">${String(from)}–${String(to)} de ${String(page.total)}</p>
            ${HistorySteps({ filters, total: page.total })}` as Html)
          : "",
    })}
  </div>` as Html;
}

export function RunDetail({
  run,
  children,
  nested,
  syncs,
}: {
  run: JobRun;
  children: JobRun[];
  nested?: Map<number, JobRun[]>;
  syncs: SyncRun[];
}): Html {
  return html`<article id="execucio-${run.id}" class="superficie targeta">
    <header class="item-cap">
      <div>
        <h3>${jobLabel(run.jobName)}</h3>
        <p class="text-suau">
          <span class="${stateClass(run.status)}">${STATUS_LABELS[run.status]}</span>
          · ${TRIGGER_LABELS[run.trigger]}
          · <time datetime="${run.startedAt.toISOString()}">${dateTime.format(run.startedAt)}</time>
          · ${duration(run)}
        </p>
      </div>
    </header>

    ${
      children.length > 0
        ? html`<section class="feines-bloc">
          <h4 class="menu-titol">Passos</h4>
          ${PipelineDiagram({ runs: children, nested })}
        </section>`
        : ""
    }

    ${
      run.summary
        ? html`<pre class="feines-resum">${run.summary}</pre>`
        : html`<p class="text-suau">Sense resum.</p>`
    }
    ${run.error ? html`<p class="negatiu"><strong>Error:</strong> ${run.error}</p>` : ""}

    ${
      syncs.length > 0
        ? html`<section class="feines-bloc">
          <h4 class="menu-titol">Importacions bancaries</h4>
          <ol class="feines-pipeline feines-pipeline-compacta">
            ${syncs.map(
              (s, i) => html`<li class="feines-pipeline-pas">
                ${i > 0 ? html`<span class="feines-pipeline-fletxa" aria-hidden="true">→</span>` : ""}
                <div class="feines-pipeline-node">
                  <span class="${stateClass(s.status)}">${STATUS_LABELS[s.status]}</span>
                  <strong>connexio #${String(s.connectionId)}</strong>
                  <span class="text-suau">
                    ${String(s.transactionsInserted)} nous,
                    ${String(s.transactionsUpdated)} actualitzats,
                    ${String(s.accountsSynced)} comptes
                  </span>
                  ${s.error ? html`<span class="negatiu">${excerpt(s.error, 80)}</span>` : ""}
                </div>
              </li>`,
            )}
          </ol>
        </section>`
        : ""
    }
  </article>` as Html;
}

/** Builds the schedule entries from the configuration. */
export function scheduleEntries(latest: Map<string, JobRun>): ScheduleEntry[] {
  const items: ScheduleEntry[] = [
    {
      id: "passada-diaria",
      title: "Passada diaria",
      time: `${pad2(config.syncCronHour)}:${pad2(config.syncCronMinute)}`,
      last: latest.get("passada-diaria") ?? null,
    },
    {
      id: "analyze",
      title: "Analisi",
      time: `${pad2(config.analysisCronHour)}:45`,
      last: latest.get("analyze") ?? null,
    },
  ];
  if (config.ollamaEnabled) {
    items.push({
      id: "passada-nocturna",
      title: "Passada nocturna",
      time: `${pad2(config.classifyCronHour)}:15`,
      last: latest.get("passada-nocturna") ?? null,
    });
    items.push(
      {
        id: "resums-diaris",
        title: "Resums diaris",
        time: "despres de la passada diaria",
        last: latest.get("resums-diaris") ?? null,
      },
      {
        id: "informes-mensuals",
        title: "Informes mensuals",
        time: `${pad2(config.reportMonthlyHour)}:00, a partir del dia ${config.reportMonthlyDay}`,
        last: latest.get("informes-mensuals") ?? null,
      },
    );
  }
  items.push(
    {
      id: "notify",
      title: "Avisos",
      time: `${pad2(config.notifyCronHour)}:00`,
      last: latest.get("notify") ?? null,
    },
    {
      id: "notify-urgents",
      title: "Avisos urgents",
      time: "cada hora (:05)",
      last: latest.get("notify-urgents") ?? null,
    },
    {
      id: "maintenance",
      title: "Manteniment",
      time: "04:30",
      last: latest.get("maintenance") ?? null,
    },
  );
  return items;
}
