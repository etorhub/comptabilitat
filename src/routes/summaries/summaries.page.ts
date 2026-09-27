/**
 * Pages of the summaries resource: the written reports.
 *
 * `GET <base>` **always** returns a whole page. The shell (sidebar,
 * workspace picker and counters) is put there by the caller, with
 * `workspacePage()`.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { MonthlyList, monthName, Report, type ReportProps } from "./summaries.fragment.ts";

export interface SummariesPageProps {
  code: string;
  daily: ReportProps;
  /** Last month's report, only while it has not been written yet. */
  lastMonth: ReportProps | null;
  monthly: { period: string; resum: string }[];
}

export function SummariesPage({ code, daily, lastMonth, monthly }: SummariesPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Resums</h1>
      <p class="text-suau">
        Cada matí, després d'importar els moviments, el model local redacta com va el mes.
        I a principis de mes, l'informe del mes que s'ha tancat. Les xifres les calcula
        l'aplicació; el model només les explica.
      </p>
      <p><a href="/e/${code}/informes">← Tornar als informes</a></p>
    </header>

    <h2>Com va el mes</h2>
    ${Report(daily)}
    ${
      lastMonth
        ? html`<h2>Informe de ${monthName(lastMonth.period)}</h2>
          ${Report(lastMonth)}`
        : ""
    }

    <h2>Informes mensuals</h2>
    <section class="superficie targeta">${MonthlyList({ code, items: monthly })}</section>
  ` as Html;
}

export function MonthlyReportPage({
  code,
  report,
}: {
  code: string;
  report: ReportProps;
}): Html {
  return html`
    <header class="capçalera">
      <h1>Informe de ${monthName(report.period)}</h1>
      <p><a href="/e/${code}/resums">← Tots els resums</a></p>
    </header>

    ${Report(report)}
  ` as Html;
}
