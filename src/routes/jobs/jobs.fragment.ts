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
import { DataTable } from "../../components/vista.ts";
import type { JobRun, JobStatus, SyncRun } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import type { Html } from "../../lib/html.ts";
import type { HistoryPage, HealthSummary } from "../../services/job-runs.ts";
import { oobAttributes } from "../../lib/oob.ts";
import { poll, pollExhausted } from "../../lib/sondeig.ts";
import {
  STATUS_LABELS,
  JOB_LABELS,
  TRIGGER_LABELS,
  type JobId,
  JOBS,
  type HistoryFilters,
  historyFiltersToQuery,
  PASSES_CONTAINING,
} from "./jobs.schema.ts";

export interface JobEntry {
  id: JobId;
  title: string;
  description: string;
}

const dateHora = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: config.timezone,
});

const dateCurta = new Intl.DateTimeFormat("ca-ES", {
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
      return "etiqueta etiqueta-suau";
    default:
      return "etiqueta etiqueta-suau";
  }
}

function durada(run: JobRun): string {
  const fi = run.finishedAt?.getTime() ?? Date.now();
  const segons = Math.max(0, Math.round((fi - run.startedAt.getTime()) / 1000));
  if (segons < 60) return `${segons}s`;
  const min = Math.floor(segons / 60);
  const rest = segons % 60;
  if (min < 60) return rest === 0 ? `${min} min` : `${min} min ${rest}s`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

function extracte(text: string, max = 120): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface ScheduleEntry {
  id: JobId;
  title: string;
  hora: string;
  darrera: JobRun | null;
}

export function ScheduleHealth({
  entrades,
  salut,
  oob = false,
}: {
  entrades: ScheduleEntry[];
  salut: HealthSummary;
  oob?: boolean;
}): Html {
  const pass = salut.darreraPassadaDiaria;
  return html`<section
    ${oobAttributes("agenda-salut", oob)}
    class="superficie targeta"
  >
    <h2 class="menu-titol">Agenda i salut</h2>
    <div class="feines-comptadors">
      <p>
        <strong>${String(salut.enCurs)}</strong>
        <span class="text-suau">en curs</span>
      </p>
      <p>
        <strong>${String(salut.fallades24h)}</strong>
        <span class="text-suau">fallades (24 h)</span>
      </p>
      <p>
        <span class="text-suau">Darrera passada diaria:</span>
        ${
          pass
            ? html`<span class="${stateClass(pass.status)}">${STATUS_LABELS[pass.status]}</span>
              <time class="text-suau" datetime="${pass.startedAt.toISOString()}">
                ${dateCurta.format(pass.startedAt)}
              </time>`
            : html`<span class="text-suau">encara no n'hi ha</span>`
        }
      </p>
    </div>
    <ul class="feines-agenda">
      ${entrades.map(
        (e) => html`<li>
          <strong>${e.title}</strong>
          <span class="text-suau">${e.hora}</span>
          ${
            e.darrera
              ? html`<span class="${stateClass(e.darrera.status)}">${STATUS_LABELS[e.darrera.status]}</span>
                <span class="text-suau">${durada(e.darrera)}</span>`
              : html`<span class="text-suau">—</span>`
          }
        </li>`,
      )}
    </ul>
  </section>` as Html;
}

function buttonBlocked(id: JobId, enCurs: Set<string>): boolean {
  if (enCurs.has(id)) return true;
  for (const pass of PASSES_CONTAINING[id] ?? []) {
    if (enCurs.has(pass)) return true;
  }
  // If a step this pass would include is running, do not start it again.
  if (id === "passada-diaria" || id === "totes") {
    for (const step of ["sync", "classify", "analyze"] as const) {
      if (enCurs.has(step)) return true;
    }
  }
  if (id === "passada-nocturna" || id === "totes") {
    for (const step of ["llm", "classify"] as const) {
      if (enCurs.has(step)) return true;
    }
  }
  if (id === "totes") {
    for (const step of [
      "notify",
      "maintenance",
      "passada-diaria",
      "passada-nocturna",
    ] as const) {
      if (enCurs.has(step)) return true;
    }
  }
  return false;
}

export function ButtonJob({
  id,
  title,
  description,
  darrera,
  enCurs,
}: JobEntry & { darrera: JobRun | null; enCurs: Set<string> }): Html {
  const blocked = buttonBlocked(id, enCurs);
  return html`<div class="superficie targeta">
    <div class="item-cap">
      <div>
        <strong>${title}</strong>
        ${
          darrera
            ? html`<span class="${stateClass(darrera.status)}">${STATUS_LABELS[darrera.status]}</span>
              <span class="text-suau">${dateCurta.format(darrera.startedAt)} · ${durada(darrera)}</span>`
            : html`<span class="etiqueta etiqueta-suau">Mai</span>`
        }
        <p class="text-suau">${description}</p>
      </div>
      <form
        hx-post="/feines"
        hx-swap="none"
        hx-disabled-elt="find button"
      >
        <input type="hidden" name="feina" value="${id}" />
        <button type="submit" class="boto" ${blocked ? raw("disabled") : ""}>
          ${blocked ? "En curs…" : "Executa"}
        </button>
      </form>
    </div>
  </div>` as Html;
}

export function JobsList({
  passes,
  individuals,
  darreres,
  enCurs,
  oob = false,
}: {
  passes: JobEntry[];
  individuals: JobEntry[];
  darreres: Map<string, JobRun>;
  enCurs: Set<string>;
  oob?: boolean;
}): Html {
  return html`<div ${oobAttributes("llista-feines", oob)}>
    <section>
      <h2 class="menu-titol">Passades</h2>
      ${passes.map((job) =>
        ButtonJob({
          ...job,
          darrera: darreres.get(job.id) ?? null,
          enCurs,
        }),
      )}
    </section>
    <section>
      <h2 class="menu-titol">Feines</h2>
      ${individuals.map((job) =>
        ButtonJob({
          ...job,
          darrera: darreres.get(job.id) ?? null,
          enCurs,
        }),
      )}
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
 * says so, instead of asking indefinitely. See `lib/sondeig.ts`.
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
  const corrent = runs.length > 0;
  const exhausted = corrent && pollExhausted(attempt);
  return html`<section
    ${oobAttributes("en-curs", oob)}
    class="superficie targeta"
    ${corrent ? poll({ url: "/feines/fragment/en-curs", target: "#en-curs", attempt }) : ""}
    role="status"
    aria-live="polite"
  >
    <h2 class="menu-titol">En curs</h2>
    ${
      exhausted
        ? html`<p class="text-suau">
          Fa massa estona que dura; s'ha deixat de comprovar.
          <a href="/feines">Torna-ho a mirar</a>.
        </p>`
        : ""
    }
    ${
      corrent
        ? html`<ul class="feines-en-curs">
          ${runs.map(
            (run) => html`<li>
              <span class="filador" aria-hidden="true"></span>
              <strong>${jobLabel(run.jobName)}</strong>
              <span class="etiqueta">${TRIGGER_LABELS[run.trigger]}</span>
              <time class="text-suau" datetime="${run.startedAt.toISOString()}">
                des de ${dateHora.format(run.startedAt)} · ${durada(run)}
              </time>
            </li>`,
          )}
        </ul>`
        : html`<p class="text-suau">Cap feina corrent ara mateix.</p>`
    }
  </section>` as Html;
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
      tag: "Feina",
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
            <ul>
              ${children.map(
                (f) => html`<li>
                  <span class="${stateClass(f.status)}">${STATUS_LABELS[f.status]}</span>
                  ${jobLabel(f.jobName)}
                  <span class="text-suau">${durada(f)}</span>
                </li>`,
              )}
            </ul>
          </details>`
          : ""
      }
    </td>
    <td><span class="etiqueta etiqueta-suau">${TRIGGER_LABELS[run.trigger]}</span></td>
    <td><span class="${stateClass(run.status)}">${STATUS_LABELS[run.status]}</span></td>
    <td>
      <time datetime="${run.startedAt.toISOString()}">${dateHora.format(run.startedAt)}</time>
    </td>
    <td>${durada(run)}</td>
    <td class="${run.status === "failed" ? "negatiu" : "text-suau"}">
      ${summary ? extracte(summary) : "—"}
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
      columnes:
        html`<th>Feina</th><th>Origen</th><th>Estat</th><th>Inici</th><th>Durada</th><th>Resultat</th>` as Html,
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
  syncs,
}: {
  run: JobRun;
  children: JobRun[];
  syncs: SyncRun[];
}): Html {
  return html`<article id="execucio-${run.id}" class="superficie targeta">
    <header class="item-cap">
      <div>
        <h2>${jobLabel(run.jobName)}</h2>
        <p class="text-suau">
          <span class="${stateClass(run.status)}">${STATUS_LABELS[run.status]}</span>
          · ${TRIGGER_LABELS[run.trigger]}
          · <time datetime="${run.startedAt.toISOString()}">${dateHora.format(run.startedAt)}</time>
          · ${durada(run)}
        </p>
      </div>
    </header>

    ${
      run.summary
        ? html`<pre class="feines-resum">${run.summary}</pre>`
        : html`<p class="text-suau">Sense resum.</p>`
    }
    ${run.error ? html`<p class="negatiu"><strong>Error:</strong> ${run.error}</p>` : ""}

    ${
      children.length > 0
        ? html`<section>
          <h3 class="menu-titol">Passos</h3>
          <ul class="feines-en-curs">
            ${children.map(
              (f) => html`<li>
                <span class="${stateClass(f.status)}">${STATUS_LABELS[f.status]}</span>
                <strong>${jobLabel(f.jobName)}</strong>
                <span class="text-suau">${durada(f)}</span>
                ${f.error ? html`<span class="negatiu">${extracte(f.error, 80)}</span>` : ""}
                ${
                  f.summary && !f.error
                    ? html`<span class="text-suau">${extracte(f.summary, 80)}</span>`
                    : ""
                }
              </li>`,
            )}
          </ul>
        </section>`
        : ""
    }

    ${
      syncs.length > 0
        ? html`<section>
          <h3 class="menu-titol">Importacions bancaries</h3>
          <ul class="feines-en-curs">
            ${syncs.map(
              (s) => html`<li>
                <span class="${stateClass(s.status)}">${STATUS_LABELS[s.status]}</span>
                connexio #${String(s.connectionId)}:
                ${String(s.transactionsInserted)} nous,
                ${String(s.transactionsUpdated)} actualitzats,
                ${String(s.accountsSynced)} comptes
                ${s.error ? html`<span class="negatiu">${extracte(s.error, 80)}</span>` : ""}
              </li>`,
            )}
          </ul>
        </section>`
        : ""
    }
  </article>` as Html;
}

/** Builds the schedule entries from the configuration. */
export function scheduleEntries(darreres: Map<string, JobRun>): ScheduleEntry[] {
  const items: ScheduleEntry[] = [
    {
      id: "passada-diaria",
      title: "Passada diaria",
      hora: `${pad2(config.syncCronHour)}:${pad2(config.syncCronMinute)}`,
      darrera: darreres.get("passada-diaria") ?? null,
    },
    {
      id: "analyze",
      title: "Analisi",
      hora: `${pad2(config.analysisCronHour)}:45`,
      darrera: darreres.get("analyze") ?? null,
    },
  ];
  if (config.ollamaEnabled) {
    items.push({
      id: "passada-nocturna",
      title: "Passada nocturna",
      hora: `${pad2(config.classifyCronHour)}:15`,
      darrera: darreres.get("passada-nocturna") ?? null,
    });
  }
  items.push(
    {
      id: "notify",
      title: "Avisos",
      hora: `${pad2(config.notifyCronHour)}:00`,
      darrera: darreres.get("notify") ?? null,
    },
    {
      id: "notify-urgents",
      title: "Avisos urgents",
      hora: "cada hora (:05)",
      darrera: darreres.get("notify-urgents") ?? null,
    },
    {
      id: "maintenance",
      title: "Manteniment",
      hora: "04:30",
      darrera: darreres.get("maintenance") ?? null,
    },
  );
  return items;
}
