/**
 * Dashboard, reports and forecast.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { BalancePoint } from "../../services/balances.ts";
import type { Forecast } from "../../services/forecast.ts";
import type {
  IncomeAndExpenses,
  MonthlyPoint,
  CategoryPart,
  MerchantPart,
} from "../../services/reports.ts";
import {
  CategoryChart,
  MerchantChart,
  MonthlyChart,
  ForecastChart,
  BalanceChart,
  HeaderBalance,
  CategoriesTable,
  EventsTable,
  Stat,
} from "./analytics.fragment.ts";
import type { ReportFilters } from "./analytics.schema.ts";

export interface DashboardPageProps {
  code: string;
  workspaceName: string;
  workspaceColor: string;
  balance: string;
  balanceDate: string | null;
  mesActual: IncomeAndExpenses;
  perRevisar: number;
  unclassified: number;
  activeAlerts: number;
  /** The alerts link only makes sense for installation administrators. */
  canSeeAlerts: boolean;
  monthly: MonthlyPoint[];
  categories: CategoryPart[];
  balances: BalancePoint[];
}

export function DashboardPage(props: DashboardPageProps): Html {
  const {
    code,
    workspaceName,
    workspaceColor,
    balance,
    balanceDate,
    mesActual,
    perRevisar,
    unclassified,
    activeAlerts,
    canSeeAlerts,
    monthly,
    categories,
    balances,
  } = props;

  return html`
    <header class="capçalera">
      <h1>
        <span class="punt punt-gran" style="background:${workspaceColor}" aria-hidden="true"></span>
        ${workspaceName}
      </h1>
    </header>

    <div class="xifres">
      ${HeaderBalance({ balance, date: balanceDate })}
      ${Stat({
        tag: "Aquest mes",
        value: formatMoney(mesActual.cleaned),
        to: mesActual.cleaned.startsWith("-") ? "negatiu" : "positiu",
        detail: html`${formatMoney(mesActual.income)} entren ·
        ${formatMoney(mesActual.expenses)} surten`,
      })}
      ${Stat({
        tag: "Per revisar",
        value: String(perRevisar),
        href: `/e/${code}/moviments/revisio`,
        detail: unclassified > 0 ? `${unclassified} sense classificar` : "",
      })}
      ${Stat({
        tag: "Avisos",
        value: String(activeAlerts),
        href: canSeeAlerts ? `/e/${code}/avisos` : undefined,
      })}
    </div>

    ${MonthlyChart(monthly)}

    <div class="dues-columnes">
      ${CategoryChart(categories)}
      ${BalanceChart(balances)}
    </div>
  ` as Html;
}

export interface ReportsPageProps {
  code: string;
  filters: ReportFilters;
  totals: IncomeAndExpenses;
  monthly: MonthlyPoint[];
  expensesPerCategory: CategoryPart[];
  incomeByCategory: CategoryPart[];
  merchantList: MerchantPart[];
}

export function ReportsPage(props: ReportsPageProps): Html {
  const {
    code,
    filters,
    totals,
    monthly,
    expensesPerCategory,
    incomeByCategory,
    merchantList,
  } = props;

  return html`
    <header class="capçalera">
      <h1>Informes</h1>
    </header>

    <form
      class="filtres superficie targeta"
      hx-get="/e/${code}/informes/fragment/contingut"
      hx-target="#contingut-informes"
      hx-swap="outerHTML"
      hx-trigger="change"
    >
      <label class="camp camp-linia camp-estret">
        <span class="camp-etiqueta">Des de</span>
        <input type="date" name="des" value="${filters.des ?? ""}" />
      </label>
      <label class="camp camp-linia camp-estret">
        <span class="camp-etiqueta">Fins a</span>
        <input type="date" name="fins" value="${filters.to ?? ""}" />
      </label>
      <label class="camp camp-linia camp-estret">
        <span class="camp-etiqueta">Mesos</span>
        <select name="mesos">
          ${[6, 12, 24, 36].map(
            (m) =>
              html`<option value="${m}" ${m === filters.mesos ? "selected" : ""}>${m}</option>`,
          )}
        </select>
      </label>

      <span class="descarregues">
        <a class="boto boto-discret" href="/e/${code}/informes/informe.xlsx?mesos=${filters.mesos}">
          Excel
        </a>
        <a class="boto boto-discret" href="/e/${code}/informes/informe.pdf">PDF</a>
      </span>
    </form>

    ${ReportsContent({
      totals,
      monthly,
      expensesPerCategory,
      incomeByCategory,
      merchantList,
    })}
  ` as Html;
}

export interface ReportsContentProps {
  totals: IncomeAndExpenses;
  monthly: MonthlyPoint[];
  expensesPerCategory: CategoryPart[];
  incomeByCategory: CategoryPart[];
  merchantList: MerchantPart[];
}

export function ReportsContent(props: ReportsContentProps): Html {
  const { totals, monthly, expensesPerCategory, incomeByCategory, merchantList } = props;

  return html`<div id="contingut-informes">
    <div class="xifres">
      ${Stat({ tag: "Ingressos", value: formatMoney(totals.income), to: "positiu" })}
      ${Stat({ tag: "Despeses", value: formatMoney(totals.expenses), to: "negatiu" })}
      ${Stat({
        tag: "Resultat",
        value: formatMoney(totals.cleaned),
        to: totals.cleaned.startsWith("-") ? "negatiu" : "positiu",
      })}
    </div>

    ${MonthlyChart(monthly)} ${MerchantChart(merchantList)}

    <section class="superficie targeta">
      <h2>Despeses per categoria</h2>
      ${CategoriesTable(expensesPerCategory)}
    </section>

    <section class="superficie targeta">
      <h2>Ingressos per categoria</h2>
      ${CategoriesTable(incomeByCategory)}
    </section>
  </div>` as Html;
}

export interface ForecastPageProps {
  code: string;
  forecast: Forecast;
}

export function ForecastPage({ code, forecast }: ForecastPageProps): Html {
  return ForecastContent({ code, forecast });
}

export function ForecastContent({
  code,
  forecast,
}: {
  code: string;
  forecast: Forecast;
}): Html {
  const last = forecast.points[forecast.points.length - 1];
  const finalBalance = last?.esperat ?? forecast.openingBalance;
  const difference = money(finalBalance).minus(money(forecast.openingBalance));
  const differenceText = `${difference.isPositive() ? "+" : ""}${formatMoney(difference)}`;

  return html`<div id="previsio-contingut">
    <div class="dues-columnes previsio-cap">
      <div>
        <header class="capçalera">
          <h1>Previsio</h1>
          <p class="text-suau">
            Al saldo d'avui s'hi sumen els rebuts previstos que has confirmat a
            Recurrents (import fix o mitjana recent). Serveix per veure si
            arribaras a la propera nomina sense passar del llindar.
          </p>
        </header>

        ${
          forecast.firstOverdraft !== null
            ? html`<p class="avis-fort" role="alert">
              Amb aquest ritme, el saldo baixaria a
              <strong>${formatMoney(forecast.firstOverdraftAmount)}</strong> el
              <strong>${formatDate(forecast.firstOverdraft)}</strong>, per sota del
              llindar de ${formatMoney(forecast.llindar)}.
            </p>`
            : ""
        }

        <form
          class="filtres"
          hx-get="/e/${code}/previsio/fragment/grafic"
          hx-target="#previsio-contingut"
          hx-swap="outerHTML"
          hx-trigger="change"
        >
          <label class="camp camp-linia camp-estret">
            <span class="camp-etiqueta">Horitzo</span>
            <select name="horitzo">
              ${[30, 60, 90, 180].map(
                (d) =>
                  html`<option value="${d}" ${d === forecast.horizonDays ? "selected" : ""}>
                    ${d} dies
                  </option>`,
              )}
            </select>
          </label>
        </form>
      </div>

      <div class="xifres previsio-xifres">
        ${Stat({ tag: "Saldo d'avui", value: formatMoney(forecast.openingBalance) })}
        ${Stat({ tag: "Llindar de descobert", value: formatMoney(forecast.llindar) })}
        ${Stat({
          tag: `D'aqui a ${forecast.horizonDays} dies`,
          value: formatMoney(finalBalance),
          to: difference.isNegative() ? "negatiu" : difference.isPositive() ? "positiu" : "",
          detail: difference.isZero() ? "igual que avui" : `${differenceText} respecte d'avui`,
        })}
      </div>
    </div>

    ${ForecastChart(forecast)}

    <section class="superficie targeta">
      <h2>Rebuts previstos</h2>
      ${EventsTable(forecast)}
    </section>
  </div>` as Html;
}
