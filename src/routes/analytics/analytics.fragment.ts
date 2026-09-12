/**
 * Analytics fragments.
 *
 * The charts are **islands**: the server writes the data inside a
 * `<script type="application/json">` and `public/grafics.js` draws it. There
 * is no client state and no bundler; if the JavaScript does not arrive, a gap
 * is shown and the rest of the page (the tables, the figures) keeps
 * working.
 */

import { html } from "hono/html";

import { DataTable } from "../../components/views.ts";
import type { Html } from "../../lib/html.ts";
import { jsonScript } from "../../lib/http.ts";
import { formatMoney, toChartNumber } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { BalancePoint } from "../../services/balances.ts";
import type { Forecast } from "../../services/forecast.ts";
import type { MonthlyPoint, CategoryPart, MerchantPart } from "../../services/reports.ts";

/**
 * A chart's wrapper.
 *
 * `role="img"` with a description: a chart with no alternative text says
 * nothing to someone using a screen reader. The table that usually sits next
 * to it is the readable version of the same data.
 */
function Chart({
  type,
  id,
  title,
  description,
  data,
  alçada = 260,
}: {
  type: string;
  id: string;
  title: string;
  description: string;
  data: unknown;
  alçada?: number;
}): Html {
  return html`<section class="superficie targeta">
    <h2>${title}</h2>
    <div
      data-grafic="${type}"
      id="${id}"
      class="grafic"
      style="--alçada:${String(alçada)}px"
      role="img"
      aria-label="${description}"
    >
      ${jsonScript(`${id}-dades`, data)}
    </div>
  </section>` as Html;
}

/**
 * Amounts are converted to `number` here, not in the services.
 *
 * `MonthlyPoint`, `CategoryPart`, `BalancePoint`, `MerchantPart` and
 * `ForecastPoint` are `MoneyString`: the same row serves both `formatMoney()`
 * in the tables (`CategoriesTable`, `EventsTable`, the forecast page) and the
 * chart. Changing the service's type to keep the chart happy would have
 * broken those tables —`formatMoney()` does not accept `number`. The chart is
 * the only thing that needs `number`, so it is the one that asks for it, with
 * `toChartNumber()`.
 */
export function MonthlyChart(data: MonthlyPoint[]): Html {
  return Chart({
    type: "mensual",
    id: "grafic-mensual",
    title: "Mes a mes",
    description: "Ingressos, despeses fixes i variables, i resultat de cada mes",
    data: data.map((d) => ({
      periode: d.periode,
      income: toChartNumber(d.income),
      fixedExpenses: toChartNumber(d.fixedExpenses),
      variableExpenses: toChartNumber(d.variableExpenses),
      cleaned: toChartNumber(d.cleaned),
    })),
  });
}

export function CategoryChart(data: CategoryPart[]): Html {
  return Chart({
    type: "categories",
    id: "grafic-categories",
    title: "On van les despeses",
    description: "Repartiment de la despesa per categoria",
    data: data.map((d) => ({
      categoryName: d.categoryName,
      color: d.color,
      amount: toChartNumber(d.amount),
    })),
  });
}

export function BalanceChart(data: BalancePoint[]): Html {
  return Chart({
    type: "saldos",
    id: "grafic-saldos",
    title: "Evolucio del saldo",
    description: "Saldo dia a dia, reconstruit cap enrere des del saldo d'avui",
    data: data.map((d) => ({ day: d.day, balance: toChartNumber(d.balance) })),
  });
}

export function MerchantChart(data: MerchantPart[]): Html {
  return Chart({
    type: "comercos",
    id: "grafic-comercos",
    title: "On es gasta mes",
    description: "Els comerços amb mes despesa",
    data: data.map((d) => ({
      merchantName: d.merchantName,
      amount: toChartNumber(d.amount),
    })),
    alçada: 320,
  });
}

export function ForecastChart(forecast: Forecast): Html {
  const billDays = [...new Set(forecast.events.map((e) => e.day))];
  return Chart({
    type: "previsio",
    id: "grafic-previsio",
    title: "Saldo previst",
    description: `Saldo real dels darrers ${forecast.horizonDays} dies i projeccio a ${forecast.horizonDays} dies`,
    data: {
      historic: forecast.historic.map((p) => ({
        day: p.day,
        balance: toChartNumber(p.balance),
      })),
      points: forecast.points.map((p) => ({
        day: p.day,
        esperat: toChartNumber(p.esperat),
        optimista: toChartNumber(p.optimista),
        pessimista: toChartNumber(p.pessimista),
        trend: toChartNumber(p.trend),
      })),
      llindar: toChartNumber(forecast.llindar),
      firstOverdraft: forecast.firstOverdraft,
      billDays,
    },
    alçada: 320,
  });
}

// --- Figures ---------------------------------------------------------------

export interface StatProps {
  tag: string;
  value: string;
  detail?: Html | string;
  to?: "positiu" | "negatiu" | "";
  href?: string;
}

export function Stat({ tag, value, detail, to = "", href }: StatProps): Html {
  const body = html`<span class="xifra-etiqueta">${tag}</span>
    <strong class="xifra-valor ${to}">${value}</strong>
    ${detail ? html`<small class="text-suau">${detail}</small>` : ""}`;

  return href
    ? (html`<a class="xifra xifra-enllac" href="${href}">${body}</a>` as Html)
    : (html`<div class="xifra">${body}</div>` as Html);
}

// --- Readable tables -------------------------------------------------------

/**
 * The same information as the chart, in text.
 *
 * It is not an extra: it is what makes the page work without JavaScript and
 * what a screen reader can read.
 */
export function CategoriesTable(data: CategoryPart[]): Html {
  return DataTable({
    columnes: html`<th>Categoria</th>
      <th class="dreta">Import</th>
      <th class="dreta">Part</th>
      <th class="dreta">Moviments</th>` as Html,
    rows: data.map(
      (part) =>
        html`<tr>
          <td>
            <span class="punt" style="background:${part.color}" aria-hidden="true"></span>
            ${part.categoryName}
          </td>
          <td class="dreta">${formatMoney(part.amount)}</td>
          <td class="dreta">${String(Math.round(part.share * 100))}%</td>
          <td class="dreta">${String(part.transactions)}</td>
        </tr>` as Html,
    ),
    empty: "Encara no hi ha despeses classificades.",
  });
}

export function EventsTable(forecast: Forecast): Html {
  return DataTable({
    columnes: html`<th>Dia</th>
      <th>Rebut</th>
      <th class="dreta">Import</th>` as Html,
    rows: forecast.events.map(
      (e) =>
        html`<tr>
          <td><time datetime="${e.day}">${formatDate(e.day)}</time></td>
          <td>${e.label}</td>
          <td class="dreta ${e.amount.startsWith("-") ? "negatiu" : "positiu"}">
            ${formatMoney(e.amount)}
          </td>
        </tr>` as Html,
    ),
    empty: "No hi ha cap rebut previst dins d'aquest horitzo.",
  });
}

/**
 * The balance in the dashboard header.
 *
 * **It is not an out-of-band target**, even though `AGENTS.md` used to say
 * so: synchronizing is done from `/connexions`, an administration page with
 * no particular workspace, and the balance lives in a workspace's dashboard
 * (`/e/:codi`) —two pages that never coexist in the browser's DOM. There is
 * no mutation in the dashboard itself that has to refresh it without a
 * reload. It stays up to date because **it is recomputed every time the
 * dashboard is loaded**.
 */
export function HeaderBalance({
  balance,
  date,
}: {
  balance: string;
  date: string | null;
}): Html {
  return html`<div id="saldo-capcalera" class="xifra">
    <span class="xifra-etiqueta">Saldo</span>
    <strong class="xifra-valor">${formatMoney(balance)}</strong>
    <small class="text-suau">
      ${date ? html`a ${formatDate(date)}` : "encara no s'ha importat cap saldo"}
    </small>
  </div>` as Html;
}
