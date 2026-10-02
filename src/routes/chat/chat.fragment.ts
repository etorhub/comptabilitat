/**
 * Fragments of the chat resource.
 *
 * `Conversation` is what the question form swaps; `Message` is what a pending
 * answer polls for; `ActionCard` is what applying or undoing a proposal swaps.
 *
 * **This is one of the application's three polls.** A pending answer asks for
 * itself every few seconds, and stops in two ways: when the answer is written
 * the fragment carries no trigger, and if it never is, the attempt counter runs
 * out and the message says so. See `lib/polling.ts`.
 */

import { html, raw } from "hono/html";

import { DataTable, Spinner } from "../../components/views.ts";
import { fieldError, type FieldErrors } from "../../components/form.ts";
import type { ChatMessage } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { jsonScript } from "../../lib/http.ts";
import { formatMoney, toChartNumber } from "../../lib/money.ts";
import { poll, pollExhausted } from "../../lib/polling.ts";
import { LOCAL_TZ, localDateOf, todayLocal } from "../../lib/time.ts";
import type { ActionView } from "../../services/chat-actions.ts";
import { shortDate } from "../../services/chat-intents.ts";
import type {
  AnswerPayload,
  BreakdownPart,
  ListRow,
  MonthPoint,
  Totals,
} from "../../services/chat-queries.ts";
import type { ConversationSummary } from "../../services/chat.ts";
import { POLL_SECONDS, pollAttempts } from "./chat.schema.ts";

export interface ConversationProps {
  code: string;
  /** Null on the empty page, before the first question. */
  conversationId: number | null;
  messages: ChatMessage[];
  actions: Map<number, ActionView>;
  canEdit: boolean;
  enabled: boolean;
  /** What the person typed, when it comes back with an error. */
  question?: string;
  errors?: FieldErrors | undefined;
}

// --- The list of conversations ---------------------------------------------

const iconDelete = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M3 6h18" />
  <path d="M8 6V4h8v2" />
  <path d="M19 6l-1 14H6L5 6" />
</svg>`;

const dayFormat = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  timeZone: LOCAL_TZ,
});
const timeFormat = new Intl.DateTimeFormat("ca-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: LOCAL_TZ,
});

/** «14:05» for today, «3 de set.» for any other day. */
function when(instant: Date): string {
  return localDateOf(instant) === todayLocal()
    ? timeFormat.format(instant)
    : dayFormat.format(instant);
}

/**
 * The sidebar of past conversations. Deleting one that is not open swaps this
 * list in place; deleting the open one takes you back to an empty chat.
 *
 * On a phone it goes under the conversation and leaves the open one out, so
 * the question you just asked is not drawn twice in a row.
 */
export function ConversationList({
  code,
  conversations,
  current,
}: {
  code: string;
  conversations: ConversationSummary[];
  current: number | null;
}): Html {
  const others = conversations.filter((c) => c.id !== current).length;
  return html`<nav
    id="xat-converses"
    class="xat-converses${others === 0 ? " xat-converses-sense-altres" : ""}"
    aria-label="Converses"
  >
    <h2 class="xat-converses-titol">Converses</h2>
    ${
      conversations.length === 0
        ? html`<p class="text-suau">Encara no n'hi ha cap.</p>`
        : html`<ul>
          ${conversations.map(
            (c) => html`<li class="xat-conversa-item">
              <a
                href="/e/${code}/xat/${String(c.id)}"
                ${c.id === current ? raw('aria-current="page"') : ""}
              >
                <span class="xat-conversa-titol">${c.title}</span>
                <span class="xat-conversa-data">${when(c.updatedAt)}</span>
              </a>
              <button
                type="button"
                class="boto-icona xat-conversa-esborra"
                aria-label="Esborra la conversa «${c.title}»"
                title="Esborra la conversa"
                hx-post="/e/${code}/xat/${String(c.id)}/esborra"
                hx-vals="${JSON.stringify({ actual: current === null ? "" : String(current) })}"
                hx-target="#xat-converses"
                hx-swap="outerHTML"
                hx-confirm="Esborrar aquesta conversa? Els canvis que ja hagis aplicat es queden."
              >
                ${iconDelete}
              </button>
            </li>`,
          )}
        </ul>`
    }
  </nav>` as Html;
}

// --- The conversation ------------------------------------------------------

const SUGGESTIONS = [
  "Quant he gastat a Glovo el darrer any?",
  "En què he gastat més aquest any?",
  "Evolució mensual de la categoria Restaurants",
];
const EDIT_SUGGESTION = "Mou tots els moviments que continguin glovo a Menjar a domicili";

function Welcome({ code, canEdit, enabled }: ConversationProps): Html {
  const suggestions = canEdit ? [...SUGGESTIONS, EDIT_SUGGESTION] : SUGGESTIONS;
  return html`<div class="xat-buit">
    <p class="xat-buit-titol">Pregunta sobre els moviments d'aquest espai.</p>
    ${
      enabled
        ? html`<p class="text-suau">Per exemple:</p>
          <ul class="xat-suggeriments">
            ${suggestions.map(
              (q) => html`<li>
                <button
                  type="button"
                  class="xat-suggeriment"
                  hx-post="/e/${code}/xat"
                  hx-vals="${JSON.stringify({ pregunta: q })}"
                  hx-target="#conversa"
                  hx-swap="outerHTML"
                  hx-disabled-elt="this"
                >
                  ${q}
                </button>
              </li>`,
            )}
          </ul>`
        : ""
    }
  </div>` as Html;
}

export function Conversation(props: ConversationProps): Html {
  const { code, conversationId, messages, actions, canEdit } = props;
  return html`<section id="conversa" class="xat-conversa">
    ${
      messages.length === 0
        ? Welcome(props)
        : html`<ol class="xat-missatges">
          ${messages.map((m) =>
            conversationId === null
              ? ""
              : Message({ code, conversationId, message: m, actions, canEdit, attempt: 0 }),
          )}
        </ol>`
    }
    ${QuestionForm(props)}
  </section>` as Html;
}

function QuestionForm({
  code,
  conversationId,
  enabled,
  question = "",
  errors,
}: ConversationProps): Html {
  const url =
    conversationId === null ? `/e/${code}/xat` : `/e/${code}/xat/${conversationId}/missatges`;
  const error = fieldError(errors, "pregunta");
  return html`<form
    class="xat-formulari"
    hx-post="${url}"
    hx-target="#conversa"
    hx-swap="outerHTML show:#pregunta:bottom"
    hx-disabled-elt="find button"
  >
    <label class="camp">
      <span class="${conversationId === null ? "camp-etiqueta" : "visualment-ocult"}"
        >La teva pregunta</span
      >
      <textarea
        name="pregunta"
        id="pregunta"
        rows="2"
        maxlength="500"
        required
        placeholder="${conversationId === null ? "Escriu la teva pregunta…" : "Continua la conversa…"}"
        ${enabled ? "" : raw("disabled")}
        ${error ? raw('aria-invalid="true" aria-describedby="pregunta-error"') : ""}
      >${question}</textarea>
      ${error ? html`<p id="pregunta-error" class="camp-error">${error}</p>` : ""}
    </label>
    ${
      enabled
        ? html`<div class="xat-formulari-peu">
          <p class="xat-nota text-suau">
            Les xifres les calcula l'aplicació; el model local només interpreta la
            pregunta. Les edicions sempre es proposen primer, i les pots desfer.
          </p>
          <button type="submit" class="boto">Envia ${Spinner()}</button>
        </div>`
        : html`<p class="text-suau">
          El model local no està activat en aquesta instal·lació
          (<code>OLLAMA_ENABLED</code>), i sense ell el xat no entén les preguntes.
        </p>`
    }
  </form>` as Html;
}

// --- A message -------------------------------------------------------------

export function Message({
  code,
  conversationId,
  message,
  actions,
  canEdit,
  attempt,
}: {
  code: string;
  conversationId: number;
  message: ChatMessage;
  actions: Map<number, ActionView>;
  canEdit: boolean;
  attempt: number;
}): Html {
  if (message.role === "user") {
    return html`<li class="xat-missatge xat-pregunta">
      <span class="visualment-ocult">Tu:</span>
      <p>${message.text}</p>
    </li>` as Html;
  }

  const id = `missatge-${message.id}`;

  if (message.status === "pending") {
    const max = pollAttempts();
    const exhausted = pollExhausted(attempt, max);
    return html`<li
      id="${id}"
      class="xat-missatge xat-resposta"
      ${
        exhausted
          ? ""
          : poll({
              url: `/e/${code}/xat/${conversationId}/fragment/missatge/${message.id}`,
              target: `#${id}`,
              attempt,
              everySeconds: POLL_SECONDS,
              maxAttempts: max,
            })
      }
      role="status"
      aria-live="polite"
    >
      ${
        exhausted
          ? html`<p><strong>S'ha deixat de comprovar.</strong></p>
            <p class="text-suau">
              La resposta triga massa. Recarrega la pàgina d'aquí a una estona per
              veure si ha arribat.
            </p>`
          : html`<p class="text-suau">Pensant… el model local pot trigar una estona.</p>`
      }
    </li>` as Html;
  }

  if (message.status === "error") {
    return html`<li id="${id}" class="xat-missatge xat-resposta xat-error" role="status">
      <p>${message.text}</p>
    </li>` as Html;
  }

  return html`<li id="${id}" class="xat-missatge xat-resposta" role="status">
    <p class="xat-titular">${message.text}</p>
    ${Payload({ code, id: message.id, payload: message.payload, actions, canEdit })}
  </li>` as Html;
}

// --- The answers -----------------------------------------------------------

function Payload({
  code,
  id,
  payload,
  actions,
  canEdit,
}: {
  code: string;
  id: number;
  payload: unknown;
  actions: Map<number, ActionView>;
  canEdit: boolean;
}): Html | "" {
  // The payload was written by `services/chat-queries.ts`; its `kind` says what it holds.
  const p = payload as AnswerPayload | null;
  if (p === null) return "";

  switch (p.kind) {
    case "total":
      return html`${Context(p.period, p.filter)} ${TransactionsLink(code, p.link)}` as Html;
    case "list":
      return html`${Context(p.period, p.filter)}
        ${ListTable(p.rows, p.totals)} ${TransactionsLink(code, p.link)}` as Html;
    case "breakdown":
      return html`${Context(p.period, p.filter)}
        ${BreakdownChart(id, p.groupBy, p.parts)} ${BreakdownTable(p.parts, p.groupBy)}` as Html;
    case "series":
      return html`${Context(p.period, p.filter)}
        ${SeriesChart(id, p.points, p.direction === "income" ? "income" : "expenses")}` as Html;
    case "compare":
      return html`${Context("", p.filter)} ${CompareTable(p.a, p.b)}` as Html;
    case "proposal": {
      const action = actions.get(p.actionId);
      return action ? ActionCard({ code, action, canEdit }) : "";
    }
    case "clarify":
      return p.options.length === 0
        ? ""
        : (html`<ul class="xat-opcions">
            ${p.options.map((o) => html`<li>${o}</li>`)}
          </ul>` as Html);
    case "unknown":
    case "forbidden":
      return "";
  }
}

function Context(period: string, filter: string): Html {
  const parts = [filter, period].filter((x) => x !== "");
  if (parts.length === 0) return html`` as Html;
  return html`<p class="xat-context text-suau">Moviments ${parts.join(", ")}.</p>` as Html;
}

function TransactionsLink(code: string, query: string): Html {
  return html`<p class="xat-enllac">
    <a href="/e/${code}/moviments${query}">Obre-ho a Moviments</a>
  </p>` as Html;
}

function Rows(rows: ListRow[]): Html[] {
  return rows.map(
    (r) =>
      html`<tr>
      <td>${shortDate(r.bookingDate)}</td>
      <td>${r.description}</td>
      <td>${r.merchantName ?? ""}</td>
      <td>${r.categoryName ?? html`<span class="text-suau">Sense classificar</span>`}</td>
      <td class="dreta ${r.amount.startsWith("-") ? "negatiu" : "positiu"}">
        ${formatMoney(r.amount)}
      </td>
    </tr>` as Html,
  );
}

const ROW_COLUMNS = html`<th>Data</th>
  <th>Concepte</th>
  <th>Comerç</th>
  <th>Categoria</th>
  <th class="dreta">Import</th>` as Html;

function ListTable(rows: ListRow[], totals: Totals): Html {
  return DataTable({
    columns: ROW_COLUMNS,
    rows: Rows(rows),
    empty: "Cap moviment.",
    footer: html`<p class="text-suau">
      Despeses ${formatMoney(totals.expenses)} · ingressos ${formatMoney(totals.income)}
    </p>` as Html,
  });
}

function BreakdownTable(parts: BreakdownPart[], groupBy: "category" | "merchant"): Html {
  return DataTable({
    columns: html`<th>${groupBy === "category" ? "Categoria" : "Comerç"}</th>
      <th class="dreta">Moviments</th>
      <th class="dreta">Import</th>` as Html,
    rows: parts.map(
      (p) =>
        html`<tr>
        <td>${p.name}</td>
        <td class="dreta">${String(p.count)}</td>
        <td class="dreta">${formatMoney(p.amount)}</td>
      </tr>` as Html,
    ),
    empty: "Cap moviment.",
  });
}

function compareRow(t: Totals & { period: string }): Html {
  return html`<tr>
    <td>${t.period}</td>
    <td class="dreta">${String(t.count)}</td>
    <td class="dreta">${formatMoney(t.expenses)}</td>
    <td class="dreta">${formatMoney(t.income)}</td>
  </tr>` as Html;
}

function CompareTable(a: Totals & { period: string }, b: Totals & { period: string }): Html {
  return DataTable({
    columns: html`<th>Període</th>
      <th class="dreta">Moviments</th>
      <th class="dreta">Despeses</th>
      <th class="dreta">Ingressos</th>` as Html,
    rows: [compareRow(a), compareRow(b)],
    empty: "Cap moviment.",
  });
}

/**
 * A chart island, like the reports' ones: the server writes the data, and
 * `public/grafics.js` draws it. The amounts become `number` here and only here.
 */
function ChartIsland(type: string, id: string, description: string, data: unknown): Html {
  return html`<div
    data-grafic="${type}"
    id="${id}"
    class="grafic xat-grafic"
    style="--alçada:240px"
    role="img"
    aria-label="${description}"
  >
    ${jsonScript(`${id}-dades`, data)}
  </div>` as Html;
}

function BreakdownChart(
  messageId: number,
  groupBy: "category" | "merchant",
  parts: BreakdownPart[],
): Html | "" {
  if (parts.length === 0) return "";
  const id = `grafic-xat-${messageId}`;
  if (groupBy === "category") {
    return ChartIsland(
      "categories",
      id,
      "Repartiment per categoria",
      parts.map((p) => ({
        categoryName: p.name,
        color: p.color ?? "#94a3b8",
        amount: toChartNumber(p.amount),
      })),
    );
  }
  return ChartIsland(
    "comercos",
    id,
    "Els comerços amb més import",
    parts.map((p) => ({ merchantName: p.name, amount: toChartNumber(p.amount) })),
  );
}

function SeriesChart(
  messageId: number,
  points: MonthPoint[],
  key: "income" | "expenses",
): Html | "" {
  if (points.length === 0) return "";
  return ChartIsland(
    "evolucio",
    `grafic-xat-${messageId}`,
    key === "income" ? "Ingressos de cada mes" : "Despesa de cada mes",
    points.map((p) => ({ periode: p.month, amount: toChartNumber(p[key]) })),
  );
}

// --- A proposal ------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A proposal from the model, and what a person can do with it. */
export function ActionCard({
  code,
  action,
  canEdit,
}: {
  code: string;
  action: ActionView;
  canEdit: boolean;
}): Html {
  const p = action.params;
  const id = `accio-${action.id}`;
  const notes: string[] = [];
  if (p.overwriteCount > 0) {
    notes.push(
      `${plural(p.overwriteCount, "moviment ja té", "moviments ja tenen")} una nota, que se substituirà.`,
    );
  }
  if (p.alreadyCount > 0) {
    notes.push(`${plural(p.alreadyCount, "moviment ja estava", "moviments ja estaven")} així.`);
  }

  const more = p.count - p.sample.length;

  return html`<div id="${id}" class="xat-accio">
    ${notes.length > 0 ? html`<ul class="xat-avisos">${notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
    ${
      p.sample.length > 0
        ? DataTable({
            columns: ROW_COLUMNS,
            rows: Rows(p.sample),
            empty: "",
            footer:
              more > 0
                ? (html`<p class="text-suau">i ${plural(more, "moviment", "moviments")} més.</p>` as Html)
                : "",
          })
        : ""
    }
    ${ActionState({ code, action, canEdit })}
  </div>` as Html;
}

function ActionState({
  code,
  action,
  canEdit,
}: {
  code: string;
  action: ActionView;
  canEdit: boolean;
}): Html {
  const base = `/e/${code}/xat/accions/${action.id}`;
  const target = `#accio-${action.id}`;

  if (action.status === "proposed") {
    return canEdit
      ? (html`<p class="xat-accions">
          <button
            type="button"
            class="boto"
            hx-post="${base}/aplica"
            hx-target="${target}"
            hx-swap="outerHTML"
            hx-disabled-elt="this"
          >
            Aplica ${Spinner()}
          </button>
        </p>` as Html)
      : (html`<p class="text-suau">Només un editor ho pot aplicar.</p>` as Html);
  }

  if (action.status === "applied") {
    return html`<p class="xat-accions">
      <strong>Aplicat.</strong>
      ${
        canEdit && action.isLastApplied
          ? html`<button
            type="button"
            class="boto boto-discret"
            hx-post="${base}/desfes"
            hx-target="${target}"
            hx-swap="outerHTML"
            hx-disabled-elt="this"
          >
            Desfés ${Spinner()}
          </button>`
          : ""
      }
    </p>` as Html;
  }

  return html`<p class="xat-accions"><strong>Desfet.</strong></p>` as Html;
}
