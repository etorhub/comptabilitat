/**
 * Fragments de la pagina de feines.
 *
 * `LlistaHistorial` i `EnCurs` es tornen tant des de la pagina com des de les
 * rutes de fragment i les mutacions. El sondeig d'`EnCurs` es la mateixa
 * excepcio documentada a AGENTS.md que el de connexions: s'atura sol quan
 * ja no hi ha cap feina `running`.
 */

import { html, raw } from "hono/html";

import { Camp, Tria } from "../../components/form.ts";
import { TaulaDades } from "../../components/vista.ts";
import type { JobRun, JobStatus, SyncRun } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import type { Html } from "../../lib/html.ts";
import type { PaginaHistorial, ResumSalut } from "../../services/job-runs.ts";
import { atributsOob } from "../../lib/oob.ts";
import { sondeig, sondeigExhaurit } from "../../lib/sondeig.ts";
import {
  ETIQUETES_ESTAT,
  ETIQUETES_FEINA,
  ETIQUETES_ORIGEN,
  type FeinaId,
  FEINES,
  type HistorialFilters,
  historialFiltersToQuery,
  PASSADES_QUE_CONTENEN,
} from "./jobs.schema.ts";

export interface EntradaFeina {
  id: FeinaId;
  titol: string;
  descripcio: string;
}

const dataHora = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: config.timezone,
});

const dataCurta = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: config.timezone,
});

function etiquetaFeina(nom: string): string {
  return ETIQUETES_FEINA[nom as FeinaId] ?? nom;
}

function classeEstat(status: JobStatus): string {
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
  const net = text.replace(/\s+/g, " ").trim();
  if (net.length <= max) return net;
  return `${net.slice(0, max - 1)}…`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface EntradaAgenda {
  id: FeinaId;
  titol: string;
  hora: string;
  darrera: JobRun | null;
}

export function AgendaSalut({
  entrades,
  salut,
  oob = false,
}: {
  entrades: EntradaAgenda[];
  salut: ResumSalut;
  oob?: boolean;
}): Html {
  const passada = salut.darreraPassadaDiaria;
  return html`<section
    ${atributsOob("agenda-salut", oob)}
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
          passada
            ? html`<span class="${classeEstat(passada.status)}">${ETIQUETES_ESTAT[passada.status]}</span>
              <time class="text-suau" datetime="${passada.startedAt.toISOString()}">
                ${dataCurta.format(passada.startedAt)}
              </time>`
            : html`<span class="text-suau">encara no n'hi ha</span>`
        }
      </p>
    </div>
    <ul class="feines-agenda">
      ${entrades.map(
        (e) => html`<li>
          <strong>${e.titol}</strong>
          <span class="text-suau">${e.hora}</span>
          ${
            e.darrera
              ? html`<span class="${classeEstat(e.darrera.status)}">${ETIQUETES_ESTAT[e.darrera.status]}</span>
                <span class="text-suau">${durada(e.darrera)}</span>`
              : html`<span class="text-suau">—</span>`
          }
        </li>`,
      )}
    </ul>
  </section>` as Html;
}

function botoBloquejat(id: FeinaId, enCurs: Set<string>): boolean {
  if (enCurs.has(id)) return true;
  for (const passada of PASSADES_QUE_CONTENEN[id] ?? []) {
    if (enCurs.has(passada)) return true;
  }
  // Si corre un pas que aquesta passada inclouria, no la tornis a engegar.
  if (id === "passada-diaria" || id === "totes") {
    for (const pas of ["sync", "classify", "analyze"] as const) {
      if (enCurs.has(pas)) return true;
    }
  }
  if (id === "passada-nocturna" || id === "totes") {
    for (const pas of ["llm", "classify"] as const) {
      if (enCurs.has(pas)) return true;
    }
  }
  if (id === "totes") {
    for (const pas of [
      "notify",
      "maintenance",
      "passada-diaria",
      "passada-nocturna",
    ] as const) {
      if (enCurs.has(pas)) return true;
    }
  }
  return false;
}

export function BotoFeina({
  id,
  titol,
  descripcio,
  darrera,
  enCurs,
}: EntradaFeina & { darrera: JobRun | null; enCurs: Set<string> }): Html {
  const bloquejat = botoBloquejat(id, enCurs);
  return html`<div class="superficie targeta">
    <div class="item-cap">
      <div>
        <strong>${titol}</strong>
        ${
          darrera
            ? html`<span class="${classeEstat(darrera.status)}">${ETIQUETES_ESTAT[darrera.status]}</span>
              <span class="text-suau">${dataCurta.format(darrera.startedAt)} · ${durada(darrera)}</span>`
            : html`<span class="etiqueta etiqueta-suau">Mai</span>`
        }
        <p class="text-suau">${descripcio}</p>
      </div>
      <form
        hx-post="/feines"
        hx-swap="none"
        hx-disabled-elt="find button"
      >
        <input type="hidden" name="feina" value="${id}" />
        <button type="submit" class="boto" ${bloquejat ? raw("disabled") : ""}>
          ${bloquejat ? "En curs…" : "Executa"}
        </button>
      </form>
    </div>
  </div>` as Html;
}

export function LlistaFeines({
  passades,
  individuals,
  darreres,
  enCurs,
  oob = false,
}: {
  passades: EntradaFeina[];
  individuals: EntradaFeina[];
  darreres: Map<string, JobRun>;
  enCurs: Set<string>;
  oob?: boolean;
}): Html {
  return html`<div ${atributsOob("llista-feines", oob)}>
    <section>
      <h2 class="menu-titol">Passades</h2>
      ${passades.map((feina) =>
        BotoFeina({
          ...feina,
          darrera: darreres.get(feina.id) ?? null,
          enCurs,
        }),
      )}
    </section>
    <section>
      <h2 class="menu-titol">Feines</h2>
      ${individuals.map((feina) =>
        BotoFeina({
          ...feina,
          darrera: darreres.get(feina.id) ?? null,
          enCurs,
        }),
      )}
    </section>
  </div>` as Html;
}

/**
 * Feines de primer nivell encara corrent.
 *
 * **Sondeig, amb limit.** Mentre n'hi hagi, el fragment demana l'intent
 * seguent; quan la feina acaba, el fragment nou ja no duu disparador i HTMX
 * s'atura. I si no acaba mai —un proces mort enmig deixa la fila en `running`
 * per sempre— el compte d'intents s'acaba i es diu, en lloc de preguntar-ho
 * indefinidament. Vegeu `lib/sondeig.ts`.
 */
export function EnCurs({
  runs,
  intent = 0,
  oob = false,
}: {
  runs: JobRun[];
  intent?: number;
  oob?: boolean;
}): Html {
  const corrent = runs.length > 0;
  const exhaurit = corrent && sondeigExhaurit(intent);
  return html`<section
    ${atributsOob("en-curs", oob)}
    class="superficie targeta"
    ${corrent ? sondeig({ url: "/feines/fragment/en-curs", objectiu: "#en-curs", intent }) : ""}
    role="status"
    aria-live="polite"
  >
    <h2 class="menu-titol">En curs</h2>
    ${
      exhaurit
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
              <strong>${etiquetaFeina(run.jobName)}</strong>
              <span class="etiqueta">${ETIQUETES_ORIGEN[run.trigger]}</span>
              <time class="text-suau" datetime="${run.startedAt.toISOString()}">
                des de ${dataHora.format(run.startedAt)} · ${durada(run)}
              </time>
            </li>`,
          )}
        </ul>`
        : html`<p class="text-suau">Cap feina corrent ara mateix.</p>`
    }
  </section>` as Html;
}

export function BarraFiltresHistorial({ filters }: { filters: HistorialFilters }): Html {
  const opcionsFeina = FEINES.map((id) => ({ valor: id, text: ETIQUETES_FEINA[id] }));
  return html`<form
    class="filtres"
    hx-get="/feines/fragment/historial"
    hx-target="#historial-feines"
    hx-swap="outerHTML"
    hx-trigger="change, submit"
  >
    ${Tria({
      nom: "feina",
      etiqueta: "Feina",
      valor: filters.feina ?? "",
      buit: "Totes",
      opcions: opcionsFeina,
    })}
    ${Tria({
      nom: "estat",
      etiqueta: "Estat",
      valor: filters.estat ?? "",
      buit: "Tots",
      opcions: [
        { valor: "running", text: "En curs" },
        { valor: "success", text: "Fet" },
        { valor: "partial", text: "Parcial" },
        { valor: "failed", text: "Ha fallat" },
      ],
    })}
    ${Tria({
      nom: "origen",
      etiqueta: "Origen",
      valor: filters.origen ?? "",
      buit: "Tots",
      opcions: [
        { valor: "scheduled", text: "Cron" },
        { valor: "manual", text: "UI" },
        { valor: "cli", text: "CLI" },
      ],
    })}
    ${Camp({
      nom: "des_de",
      etiqueta: "Des de",
      tipus: "date",
      valor: filters.des_de ?? "",
    })}
    ${Camp({
      nom: "fins_a",
      etiqueta: "Fins a",
      tipus: "date",
      valor: filters.fins_a ?? "",
    })}
  </form>` as Html;
}

function FilaExecucio(run: JobRun, fills: JobRun[]): Html {
  const resum = run.error || run.summary;
  return html`<tr>
    <td>
      <a
        href="/feines#execucio-${run.id}"
        hx-get="/feines/fragment/execucio/${run.id}"
        hx-target="#detall-execucio"
        hx-swap="innerHTML"
      >
        ${etiquetaFeina(run.jobName)}
      </a>
      ${
        fills.length > 0
          ? html`<details class="feines-fills">
            <summary class="text-suau">${String(fills.length)} passos</summary>
            <ul>
              ${fills.map(
                (f) => html`<li>
                  <span class="${classeEstat(f.status)}">${ETIQUETES_ESTAT[f.status]}</span>
                  ${etiquetaFeina(f.jobName)}
                  <span class="text-suau">${durada(f)}</span>
                </li>`,
              )}
            </ul>
          </details>`
          : ""
      }
    </td>
    <td><span class="etiqueta etiqueta-suau">${ETIQUETES_ORIGEN[run.trigger]}</span></td>
    <td><span class="${classeEstat(run.status)}">${ETIQUETES_ESTAT[run.status]}</span></td>
    <td>
      <time datetime="${run.startedAt.toISOString()}">${dataHora.format(run.startedAt)}</time>
    </td>
    <td>${durada(run)}</td>
    <td class="${run.status === "failed" ? "negatiu" : "text-suau"}">
      ${resum ? extracte(resum) : "—"}
    </td>
  </tr>` as Html;
}

function PassosHistorial({
  filters,
  total,
}: {
  filters: HistorialFilters;
  total: number;
}): Html {
  const limit = 30;
  const ultima = Math.max(0, Math.ceil(total / limit) - 1);
  const enllac = (p: number) =>
    `/feines/fragment/historial${historialFiltersToQuery({ ...filters, pagina: p })}`;

  return html`<nav class="paginacio" aria-label="Paginacio">
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina <= 0 ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina - 1)}"
      hx-target="#historial-feines"
      hx-swap="outerHTML"
    >
      Anterior
    </button>
    <span class="text-suau">
      Pagina ${String(filters.pagina + 1)} de ${String(ultima + 1)}
    </span>
    <button
      type="button"
      class="boto boto-discret"
      ${filters.pagina >= ultima ? raw("disabled") : ""}
      hx-get="${enllac(filters.pagina + 1)}"
      hx-target="#historial-feines"
      hx-swap="outerHTML"
    >
      Seguent
    </button>
  </nav>` as Html;
}

export function LlistaHistorial({
  pagina,
  filters,
  oob = false,
}: {
  pagina: PaginaHistorial;
  filters: HistorialFilters;
  oob?: boolean;
}): Html {
  const desde = pagina.total === 0 ? 0 : pagina.pagina * pagina.limit + 1;
  const fins = Math.min((pagina.pagina + 1) * pagina.limit, pagina.total);

  return html`<div ${atributsOob("historial-feines", oob)}>
    ${BarraFiltresHistorial({ filters })}
    ${TaulaDades({
      columnes:
        html`<th>Feina</th><th>Origen</th><th>Estat</th><th>Inici</th><th>Durada</th><th>Resultat</th>` as Html,
      files: pagina.items.map((run) => FilaExecucio(run, pagina.fills.get(run.id) ?? [])),
      buit: "Encara no hi ha cap execució registrada.",
      peu:
        pagina.total > 0
          ? (html`<p class="text-suau">${String(desde)}–${String(fins)} de ${String(pagina.total)}</p>
            ${PassosHistorial({ filters, total: pagina.total })}` as Html)
          : "",
    })}
  </div>` as Html;
}

export function DetallExecucio({
  run,
  fills,
  syncs,
}: {
  run: JobRun;
  fills: JobRun[];
  syncs: SyncRun[];
}): Html {
  return html`<article id="execucio-${run.id}" class="superficie targeta">
    <header class="item-cap">
      <div>
        <h2>${etiquetaFeina(run.jobName)}</h2>
        <p class="text-suau">
          <span class="${classeEstat(run.status)}">${ETIQUETES_ESTAT[run.status]}</span>
          · ${ETIQUETES_ORIGEN[run.trigger]}
          · <time datetime="${run.startedAt.toISOString()}">${dataHora.format(run.startedAt)}</time>
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
      fills.length > 0
        ? html`<section>
          <h3 class="menu-titol">Passos</h3>
          <ul class="feines-en-curs">
            ${fills.map(
              (f) => html`<li>
                <span class="${classeEstat(f.status)}">${ETIQUETES_ESTAT[f.status]}</span>
                <strong>${etiquetaFeina(f.jobName)}</strong>
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
                <span class="${classeEstat(s.status)}">${ETIQUETES_ESTAT[s.status]}</span>
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

/** Construeix les entrades de l'agenda a partir de la configuracio. */
export function entradesAgenda(darreres: Map<string, JobRun>): EntradaAgenda[] {
  const items: EntradaAgenda[] = [
    {
      id: "passada-diaria",
      titol: "Passada diaria",
      hora: `${pad2(config.syncCronHour)}:${pad2(config.syncCronMinute)}`,
      darrera: darreres.get("passada-diaria") ?? null,
    },
    {
      id: "analyze",
      titol: "Analisi",
      hora: `${pad2(config.analysisCronHour)}:45`,
      darrera: darreres.get("analyze") ?? null,
    },
  ];
  if (config.ollamaEnabled) {
    items.push({
      id: "passada-nocturna",
      titol: "Passada nocturna",
      hora: `${pad2(config.classifyCronHour)}:15`,
      darrera: darreres.get("passada-nocturna") ?? null,
    });
  }
  items.push(
    {
      id: "notify",
      titol: "Avisos",
      hora: `${pad2(config.notifyCronHour)}:00`,
      darrera: darreres.get("notify") ?? null,
    },
    {
      id: "notify-urgents",
      titol: "Avisos urgents",
      hora: "cada hora (:05)",
      darrera: darreres.get("notify-urgents") ?? null,
    },
    {
      id: "maintenance",
      titol: "Manteniment",
      hora: "04:30",
      darrera: darreres.get("maintenance") ?? null,
    },
  );
  return items;
}
