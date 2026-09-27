/**
 * Fragments of the summaries resource: one written report and its figures.
 *
 * `Report` is what the regenerate button swaps and what the page polls while
 * the local model is writing. **This is one of the application's polls**: it
 * stops when the report is written or has failed (the fragment carries no
 * trigger), and if neither ever happens, the attempt counter runs out and the
 * fragment says so. See `lib/polling.ts`.
 *
 * The text the model wrote is drawn escaped, as plain text: no markdown, no
 * HTML from the model ever reaches the page. The figures next to it come from
 * the same `facts` the model was shown, so the two can be checked against each
 * other.
 */

import { html } from "hono/html";

import { DataTable, EmptyState, Spinner } from "../../components/views.ts";
import type { AiReportKind } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { poll, pollExhausted } from "../../lib/polling.ts";
import { formatDate } from "../../lib/time.ts";
import type { ReportView } from "../../services/ai-reports.ts";
import type {
  DailyFacts,
  MonthlyFacts,
  Totals,
  Unexpected,
} from "../../services/report-facts.ts";
import { KIND_TO_WIRE, POLL_SECONDS, pollAttempts } from "./summaries.schema.ts";

const monthFormatter = new Intl.DateTimeFormat("ca-ES", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** «setembre de 2026» */
export function monthName(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

const stampFormatter = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function reportId(kind: AiReportKind, period: string): string {
  return `informe-${KIND_TO_WIRE[kind]}-${period}`;
}

function tone(value: string): string {
  return money(value).isNegative() ? "negatiu" : "positiu";
}

function stat(tag: string, value: string, extra: { to?: string; detail?: string } = {}): Html {
  return html`<div class="xifra">
    <span class="xifra-etiqueta">${tag}</span>
    <strong class="xifra-valor ${extra.to ?? ""}">${value}</strong>
    ${extra.detail ? html`<small class="text-suau">${extra.detail}</small>` : ""}
  </div>` as Html;
}

function totalsStats(t: Totals, previous: Totals, previousLabel: string): Html {
  return html`<div class="xifres">
    ${stat("Ingressos", formatMoney(t.income), {
      to: "positiu",
      detail: `${previousLabel}: ${formatMoney(previous.income)}`,
    })}
    ${stat("Despeses", formatMoney(t.expenses), {
      to: "negatiu",
      detail: `${previousLabel}: ${formatMoney(previous.expenses)}`,
    })}
    ${stat("Resultat", formatMoney(t.result), {
      to: tone(t.result),
      detail: `${previousLabel}: ${formatMoney(previous.result)}`,
    })}
  </div>` as Html;
}

// --- Unexpected expenses ---------------------------------------------------------

function UnexpectedTables(u: Unexpected): Html {
  const nothing =
    u.outsideRecurring.length +
      u.categorySpikes.length +
      u.dearerBills.length +
      u.newMerchants.length ===
    0;
  if (nothing) return EmptyState("Cap despesa inesperada.");

  return html`
    ${
      u.outsideRecurring.length > 0
        ? html`<h3>Despeses grans fora dels recurrents</h3>
          ${DataTable({
            columns: html`<th>Dia</th>
              <th>Concepte</th>
              <th>Categoria</th>
              <th class="dreta">Import</th>` as Html,
            rows: u.outsideRecurring.map(
              (e) =>
                html`<tr>
                  <td><time datetime="${e.date}">${formatDate(e.date)}</time></td>
                  <td>${e.label}</td>
                  <td>${e.category ?? "Sense classificar"}</td>
                  <td class="dreta negatiu">${formatMoney(e.amount)}</td>
                </tr>` as Html,
            ),
            empty: "",
          })}`
        : ""
    }
    ${
      u.categorySpikes.length > 0
        ? html`<h3>Categories disparades</h3>
          ${DataTable({
            columns: html`<th>Categoria</th>
              <th class="dreta">Aquest mes</th>
              <th class="dreta">Un mes normal</th>` as Html,
            rows: u.categorySpikes.map(
              (s) =>
                html`<tr>
                  <td>${s.category}</td>
                  <td class="dreta negatiu">${formatMoney(s.amount)}</td>
                  <td class="dreta">${formatMoney(s.usual)}</td>
                </tr>` as Html,
            ),
            empty: "",
          })}`
        : ""
    }
    ${
      u.dearerBills.length > 0
        ? html`<h3>Rebuts més cars del previst</h3>
          ${DataTable({
            columns: html`<th>Dia</th>
              <th>Rebut</th>
              <th class="dreta">Import</th>
              <th class="dreta">Previst</th>` as Html,
            rows: u.dearerBills.map(
              (b) =>
                html`<tr>
                  <td><time datetime="${b.date}">${formatDate(b.date)}</time></td>
                  <td>${b.label}</td>
                  <td class="dreta negatiu">${formatMoney(b.amount)}</td>
                  <td class="dreta">${formatMoney(b.expected)}</td>
                </tr>` as Html,
            ),
            empty: "",
          })}`
        : ""
    }
    ${
      u.newMerchants.length > 0
        ? html`<h3>Comerços nous</h3>
          ${DataTable({
            columns: html`<th>Primer pagament</th>
              <th>Comerç</th>
              <th class="dreta">Import</th>` as Html,
            rows: u.newMerchants.map(
              (m) =>
                html`<tr>
                  <td><time datetime="${m.date}">${formatDate(m.date)}</time></td>
                  <td>${m.label}</td>
                  <td class="dreta negatiu">${formatMoney(m.amount)}</td>
                </tr>` as Html,
            ),
            empty: "",
          })}`
        : ""
    }
  ` as Html;
}

// --- The figures of each kind ------------------------------------------------------

function DailyFigures(f: DailyFacts): Html {
  return html`
    ${totalsStats(f.totals, f.lastMonthToDate, "El mes passat, fins al mateix dia")}
    <div class="xifres">
      ${stat("Saldo actual", f.balance === null ? "—" : formatMoney(f.balance), {
        detail: f.balanceDate ? `a ${formatDate(f.balanceDate)}` : "sense saldo conegut",
      })}
      ${stat("Previst fins a final de mes", formatMoney(f.expectedTotal), {
        to: tone(f.expectedTotal),
      })}
      ${stat(
        "Saldo previst a final de mes",
        f.projectedBalance === null ? "—" : formatMoney(f.projectedBalance),
        { to: f.projectedBalance === null ? "" : tone(f.projectedBalance) },
      )}
    </div>

    <h3>Rebuts previstos fins a final de mes</h3>
    ${DataTable({
      columns: html`<th>Dia</th>
        <th>Rebut</th>
        <th class="dreta">Import</th>` as Html,
      rows: f.expected.map(
        (e) =>
          html`<tr>
            <td><time datetime="${e.date}">${formatDate(e.date)}</time></td>
            <td>${e.label}</td>
            <td class="dreta ${tone(e.amount)}">${formatMoney(e.amount)}</td>
          </tr>` as Html,
      ),
      empty: "No queda cap rebut previst aquest mes.",
    })}

    <h3>Despeses inesperades del mes</h3>
    ${UnexpectedTables(f.unexpected)}
  ` as Html;
}

function MonthlyFigures(f: MonthlyFacts): Html {
  return html`
    ${totalsStats(f.totals, f.previous, "El mes anterior")}
    <p class="text-suau">
      De les despeses, ${formatMoney(f.fixedExpenses)} són rebuts recurrents i
      ${formatMoney(f.variableExpenses)} la resta.
    </p>

    <h3>On s'ha gastat més</h3>
    ${DataTable({
      columns: html`<th>Categoria</th>
        <th class="dreta">Import</th>
        <th class="dreta">Part</th>` as Html,
      rows: f.topCategories.map(
        (c) =>
          html`<tr>
            <td>${c.category}</td>
            <td class="dreta">${formatMoney(c.amount)}</td>
            <td class="dreta">${String(c.percent)}%</td>
          </tr>` as Html,
      ),
      empty: "No hi ha hagut despeses.",
    })}

    <h3>Despeses inesperades</h3>
    ${UnexpectedTables(f.unexpected)}
  ` as Html;
}

// --- One report --------------------------------------------------------------------

export interface ReportProps {
  code: string;
  kind: AiReportKind;
  period: string;
  report: ReportView | null;
  canEdit: boolean;
  /** Whether the local model is on in this installation. */
  enabled: boolean;
  attempt: number;
}

function RegenerateButton({
  code,
  kind,
  period,
}: Pick<ReportProps, "code" | "kind" | "period">) {
  const id = reportId(kind, period);
  return html`<form
    hx-post="/e/${code}/resums/regenera"
    hx-target="#${id}"
    hx-swap="outerHTML"
    hx-disabled-elt="find button"
    hx-indicator="find .filador"
  >
    <input type="hidden" name="tipus" value="${KIND_TO_WIRE[kind]}" />
    <input type="hidden" name="periode" value="${period}" />
    <button type="submit" class="boto boto-discret">Regenera ${Spinner()}</button>
  </form>` as Html;
}

export function Report(props: ReportProps): Html {
  const { code, kind, period, report, canEdit, enabled, attempt } = props;
  const id = reportId(kind, period);
  const button = canEdit && enabled ? RegenerateButton({ code, kind, period }) : "";

  if (report?.status === "pending") {
    const max = pollAttempts();
    const exhausted = pollExhausted(attempt, max);
    return html`<section
      id="${id}"
      class="superficie targeta"
      ${
        exhausted
          ? ""
          : poll({
              url: `/e/${code}/resums/fragment/informe?tipus=${KIND_TO_WIRE[kind]}&periode=${period}`,
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
              L'informe triga massa. Recarrega la pàgina d'aquí a una estona per veure si
              ja està redactat.
            </p>`
          : html`<p class="text-suau">
              S'està redactant l'informe… el model local pot trigar uns minuts.
            </p>`
      }
    </section>` as Html;
  }

  // Without a text written by the model there is no report: no figures either.
  if (report === null || report.text === null || report.facts === null) {
    return html`<section id="${id}" class="superficie targeta">
      ${EmptyState(
        !enabled
          ? "El model local no està activat en aquesta instal·lació: no hi ha informes redactats."
          : report?.error
            ? `No s'ha pogut redactar l'informe: ${report.error}`
            : "Encara no hi ha cap informe.",
      )}
      ${button}
    </section>` as Html;
  }

  const facts = report.facts;
  return html`<section id="${id}" class="superficie targeta informe" aria-live="polite">
    <p class="informe-resum">${report.text.resum}</p>
    ${
      report.text.punts.length > 0
        ? html`<ul class="informe-punts">
          ${report.text.punts.map((p) => html`<li>${p}</li>`)}
        </ul>`
        : ""
    }
    <p class="text-suau">
      <small>
        Redactat pel model local${
          report.finishedAt ? ` el ${stampFormatter.format(report.finishedAt)}` : ""
        }. Les xifres de sota són les calculades; si el text en diu una altra, mana la
        de sota.
      </small>
    </p>
    ${
      report.error
        ? html`<p class="text-suau">
          <small>L'últim intent de regenerar-lo ha fallat: ${report.error}</small>
        </p>`
        : ""
    }
    ${button}

    <details class="informe-xifres" open>
      <summary>Les xifres</summary>
      ${facts.kind === "daily" ? DailyFigures(facts) : MonthlyFigures(facts)}
    </details>
  </section>` as Html;
}

// --- The list of monthly reports ---------------------------------------------------

export function MonthlyList({
  code,
  items,
}: {
  code: string;
  items: { period: string; resum: string }[];
}): Html {
  return DataTable({
    columns: html`<th>Mes</th>
      <th>Resum</th>` as Html,
    rows: items.map(
      (item) =>
        html`<tr>
          <td><a href="/e/${code}/resums/${item.period}">${monthName(item.period)}</a></td>
          <td>${item.resum}</td>
        </tr>` as Html,
    ),
    empty: "Encara no hi ha cap informe mensual.",
  });
}
