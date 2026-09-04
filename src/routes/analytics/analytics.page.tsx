/**
 * Panell, informes i previsio.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { formatMoney, money } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { PuntSaldo } from "../../services/balances.ts";
import type { Previsio } from "../../services/forecast.ts";
import type {
  IngressosDespeses,
  PuntMensual,
  TrosCategoria,
  TrosComerc,
} from "../../services/reports.ts";
import {
  GraficCategories,
  GraficComercos,
  GraficMensual,
  GraficPrevisio,
  GraficSaldos,
  SaldoCapcalera,
  TaulaCategories,
  TaulaEsdeveniments,
  Xifra,
} from "./analytics.fragment.tsx";
import type { ReportFilters } from "./analytics.schema.ts";

export interface DashboardPageProps {
  codi: string;
  nomEspai: string;
  colorEspai: string;
  saldo: string;
  dataSaldo: string | null;
  mesActual: IngressosDespeses;
  perRevisar: number;
  senseClassificar: number;
  avisosActius: number;
  /** L'enllaç d'avisos nomes te sentit per a administradors de la instal·lacio. */
  potVeureAvisos: boolean;
  mensual: PuntMensual[];
  categories: TrosCategoria[];
  saldos: PuntSaldo[];
}

export function DashboardPage(props: DashboardPageProps): Html {
  const {
    codi,
    nomEspai,
    colorEspai,
    saldo,
    dataSaldo,
    mesActual,
    perRevisar,
    senseClassificar,
    avisosActius,
    potVeureAvisos,
    mensual,
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
      ${SaldoCapcalera({ saldo, data: dataSaldo })}
      ${Xifra({
        etiqueta: "Aquest mes",
        valor: formatMoney(mesActual.net),
        to: mesActual.net.startsWith("-") ? "negatiu" : "positiu",
        detall: html`${formatMoney(mesActual.ingressos)} entren ·
        ${formatMoney(mesActual.despeses)} surten`,
      })}
      ${Xifra({
        etiqueta: "Per revisar",
        valor: String(perRevisar),
        href: `/e/${codi}/moviments/revisio`,
        detall: senseClassificar > 0 ? `${senseClassificar} sense classificar` : "",
      })}
      ${Xifra({
        etiqueta: "Avisos",
        valor: String(avisosActius),
        href: potVeureAvisos ? `/e/${codi}/avisos` : undefined,
      })}
    </div>

    ${GraficMensual(mensual)}

    <div class="dues-columnes">
      ${GraficCategories(categories)}
      ${GraficSaldos(saldos)}
    </div>
  ` as Html;
}

export interface ReportsPageProps {
  codi: string;
  filters: ReportFilters;
  totals: IngressosDespeses;
  mensual: PuntMensual[];
  despesesPerCategoria: TrosCategoria[];
  ingressosPerCategoria: TrosCategoria[];
  comercos: TrosComerc[];
}

export function ReportsPage(props: ReportsPageProps): Html {
  const {
    codi,
    filters,
    totals,
    mensual,
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

    ${ContingutInformes({
      totals,
      mensual,
      despesesPerCategoria,
      ingressosPerCategoria,
      comercos,
    })}
  ` as Html;
}

export interface ContingutInformesProps {
  totals: IngressosDespeses;
  mensual: PuntMensual[];
  despesesPerCategoria: TrosCategoria[];
  ingressosPerCategoria: TrosCategoria[];
  comercos: TrosComerc[];
}

export function ContingutInformes(props: ContingutInformesProps): Html {
  const { totals, mensual, despesesPerCategoria, ingressosPerCategoria, comercos } = props;

  return html`<div id="contingut-informes">
    <div class="xifres">
      ${Xifra({ etiqueta: "Ingressos", valor: formatMoney(totals.ingressos), to: "positiu" })}
      ${Xifra({ etiqueta: "Despeses", valor: formatMoney(totals.despeses), to: "negatiu" })}
      ${Xifra({
        etiqueta: "Resultat",
        valor: formatMoney(totals.net),
        to: totals.net.startsWith("-") ? "negatiu" : "positiu",
      })}
    </div>

    ${GraficMensual(mensual)} ${GraficComercos(comercos)}

    <section class="superficie targeta">
      <h2>Despeses per categoria</h2>
      ${TaulaCategories(despesesPerCategoria)}
    </section>

    <section class="superficie targeta">
      <h2>Ingressos per categoria</h2>
      ${TaulaCategories(ingressosPerCategoria)}
    </section>
  </div>` as Html;
}

export interface ForecastPageProps {
  codi: string;
  previsio: Previsio;
}

export function ForecastPage({ codi, previsio }: ForecastPageProps): Html {
  return ContingutPrevisio({ codi, previsio });
}

export function ContingutPrevisio({
  codi,
  previsio,
}: {
  codi: string;
  previsio: Previsio;
}): Html {
  const ultim = previsio.punts[previsio.punts.length - 1];
  const saldoFinal = ultim?.esperat ?? previsio.saldoInicial;
  const diferencia = money(saldoFinal).minus(money(previsio.saldoInicial));
  const diferenciaText = `${diferencia.isPositive() ? "+" : ""}${formatMoney(diferencia)}`;

  return html`<div id="previsio-contingut">
    <div class="dues-columnes previsio-cap">
      <div>
        <header class="capçalera">
          <h1>Previsio</h1>
          <p class="text-suau">
            Al saldo d'avui s'hi sumen els rebuts previstos i s'hi resta la despesa
            variable dels ultims mesos. Va en tres linies perque la despesa variable
            no es previsible amb una sola xifra.
          </p>
        </header>

        ${
          previsio.primerDescobert !== null
            ? html`<p class="avis-fort" role="alert">
              Amb aquest ritme, el saldo baixaria a
              <strong>${formatMoney(previsio.primerDescobertImport)}</strong> el
              <strong>${formatDate(previsio.primerDescobert)}</strong>, per sota del
              llindar de ${formatMoney(previsio.llindar)}.
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
                  html`<option value="${d}" ${d === previsio.horitzoDies ? "selected" : ""}>
                    ${d} dies
                  </option>`,
              )}
            </select>
          </label>
        </form>
      </div>

      <div class="xifres previsio-xifres">
        ${Xifra({ etiqueta: "Saldo d'avui", valor: formatMoney(previsio.saldoInicial) })}
        ${Xifra({
          etiqueta: "Despesa variable",
          valor: `${formatMoney(previsio.despesaDiaria)}/dia`,
        })}
        ${Xifra({ etiqueta: "Llindar de descobert", valor: formatMoney(previsio.llindar) })}
        ${Xifra({
          etiqueta: `D'aqui a ${previsio.horitzoDies} dies`,
          valor: formatMoney(saldoFinal),
          to: diferencia.isNegative() ? "negatiu" : diferencia.isPositive() ? "positiu" : "",
          detall: diferencia.isZero() ? "igual que avui" : `${diferenciaText} respecte d'avui`,
        })}
      </div>
    </div>

    ${GraficPrevisio(previsio)}

    <section class="superficie targeta">
      <h2>Rebuts previstos</h2>
      ${TaulaEsdeveniments(previsio)}
    </section>
  </div>` as Html;
}
