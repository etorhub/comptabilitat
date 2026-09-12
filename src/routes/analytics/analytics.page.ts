/**
 * Panell, informes i previsio.
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
  codi: string;
  nomEspai: string;
  colorEspai: string;
  balance: string;
  dataSaldo: string | null;
  mesActual: IncomeAndExpenses;
  perRevisar: number;
  senseClassificar: number;
  activeAlerts: number;
  /** L'enllaç d'avisos nomes te sentit per a administradors de la instal·lacio. */
  potVeureAvisos: boolean;
  monthly: MonthlyPoint[];
  categories: CategoryPart[];
  saldos: BalancePoint[];
}

export function DashboardPage(props: DashboardPageProps): Html {
  const {
    codi,
    nomEspai,
    colorEspai,
    balance,
    dataSaldo,
    mesActual,
    perRevisar,
    senseClassificar,
    activeAlerts,
    potVeureAvisos,
    monthly,
    categories,
    saldos,
  } = props;

  return html`
    <header class="capçalera">
      <h1>
        <span class="punt punt-gran" style="background:${colorEspai}" aria-hidden="true"></span>
        ${nomEspai}
      </h1>
    </header>

    <div class="xifres">
      ${HeaderBalance({ balance, date: dataSaldo })}
      ${Stat({
        tag: "Aquest mes",
        valor: formatMoney(mesActual.cleaned),
        to: mesActual.cleaned.startsWith("-") ? "negatiu" : "positiu",
        detail: html`${formatMoney(mesActual.income)} entren ·
        ${formatMoney(mesActual.expenses)} surten`,
      })}
      ${Stat({
        tag: "Per revisar",
        valor: String(perRevisar),
        href: `/e/${codi}/moviments/revisio`,
        detail: senseClassificar > 0 ? `${senseClassificar} sense classificar` : "",
      })}
      ${Stat({
        tag: "Avisos",
        valor: String(activeAlerts),
        href: potVeureAvisos ? `/e/${codi}/avisos` : undefined,
      })}
    </div>

    ${MonthlyChart(monthly)}

    <div class="dues-columnes">
      ${CategoryChart(categories)}
      ${BalanceChart(saldos)}
    </div>
  ` as Html;
}

export interface ReportsPageProps {
  codi: string;
  filters: ReportFilters;
  totals: IncomeAndExpenses;
  monthly: MonthlyPoint[];
  despesesPerCategoria: CategoryPart[];
  ingressosPerCategoria: CategoryPart[];
  comercos: MerchantPart[];
}

export function ReportsPage(props: ReportsPageProps): Html {
  const {
    codi,
    filters,
    totals,
    monthly,
    despesesPerCategoria,
    ingressosPerCategoria,
    comercos,
  } = props;

  return html`
    <header class="capçalera">
      <h1>Informes</h1>
    </header>

    <form
      class="filtres superficie targeta"
      hx-get="/e/${codi}/informes/fragment/contingut"
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
        <input type="date" name="fins" value="${filters.fins ?? ""}" />
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
        <a class="boto boto-discret" href="/e/${codi}/informes/informe.xlsx?mesos=${filters.mesos}">
          Excel
        </a>
        <a class="boto boto-discret" href="/e/${codi}/informes/informe.pdf">PDF</a>
      </span>
    </form>

    ${ReportsContent({
      totals,
      monthly,
      despesesPerCategoria,
      ingressosPerCategoria,
      comercos,
    })}
  ` as Html;
}

export interface ReportsContentProps {
  totals: IncomeAndExpenses;
  monthly: MonthlyPoint[];
  despesesPerCategoria: CategoryPart[];
  ingressosPerCategoria: CategoryPart[];
  comercos: MerchantPart[];
}

export function ReportsContent(props: ReportsContentProps): Html {
  const { totals, monthly, despesesPerCategoria, ingressosPerCategoria, comercos } = props;

  return html`<div id="contingut-informes">
    <div class="xifres">
      ${Stat({ tag: "Ingressos", valor: formatMoney(totals.income), to: "positiu" })}
      ${Stat({ tag: "Despeses", valor: formatMoney(totals.expenses), to: "negatiu" })}
      ${Stat({
        tag: "Resultat",
        valor: formatMoney(totals.cleaned),
        to: totals.cleaned.startsWith("-") ? "negatiu" : "positiu",
      })}
    </div>

    ${MonthlyChart(monthly)} ${MerchantChart(comercos)}

    <section class="superficie targeta">
      <h2>Despeses per categoria</h2>
      ${CategoriesTable(despesesPerCategoria)}
    </section>

    <section class="superficie targeta">
      <h2>Ingressos per categoria</h2>
      ${CategoriesTable(ingressosPerCategoria)}
    </section>
  </div>` as Html;
}

export interface ForecastPageProps {
  codi: string;
  forecast: Forecast;
}

export function ForecastPage({ codi, forecast }: ForecastPageProps): Html {
  return ForecastContent({ codi, forecast });
}

export function ForecastContent({
  codi,
  forecast,
}: {
  codi: string;
  forecast: Forecast;
}): Html {
  const last = forecast.points[forecast.points.length - 1];
  const finalBalance = last?.esperat ?? forecast.saldoInicial;
  const diferencia = money(finalBalance).minus(money(forecast.saldoInicial));
  const diferenciaText = `${diferencia.isPositive() ? "+" : ""}${formatMoney(diferencia)}`;

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
          hx-get="/e/${codi}/previsio/fragment/grafic"
          hx-target="#previsio-contingut"
          hx-swap="outerHTML"
          hx-trigger="change"
        >
          <label class="camp camp-linia camp-estret">
            <span class="camp-etiqueta">Horitzo</span>
            <select name="horitzo">
              ${[30, 60, 90, 180].map(
                (d) =>
                  html`<option value="${d}" ${d === forecast.horitzoDies ? "selected" : ""}>
                    ${d} dies
                  </option>`,
              )}
            </select>
          </label>
        </form>
      </div>

      <div class="xifres previsio-xifres">
        ${Stat({ tag: "Saldo d'avui", valor: formatMoney(forecast.saldoInicial) })}
        ${Stat({ tag: "Llindar de descobert", valor: formatMoney(forecast.llindar) })}
        ${Stat({
          tag: `D'aqui a ${forecast.horitzoDies} dies`,
          valor: formatMoney(finalBalance),
          to: diferencia.isNegative() ? "negatiu" : diferencia.isPositive() ? "positiu" : "",
          detail: diferencia.isZero() ? "igual que avui" : `${diferenciaText} respecte d'avui`,
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
