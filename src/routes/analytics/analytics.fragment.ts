/**
 * Fragments de les analitiques.
 *
 * Els grafics son **illes**: el servidor escriu les dades dins d'un
 * `<script type="application/json">` i `public/grafics.js` les dibuixa. No hi
 * ha cap estat de client ni cap empaquetador; si el JavaScript no arriba, es
 * veu un buit i la resta de la pagina (les taules, les xifres) continua
 * funcionant.
 */

import { html } from "hono/html";

import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { jsonScript } from "../../lib/http.ts";
import { formatMoney, toChartNumber } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { BalancePoint } from "../../services/balances.ts";
import type { Forecast } from "../../services/forecast.ts";
import type { MonthlyPoint, CategoryPart, MerchantPart } from "../../services/reports.ts";

/**
 * L'embolcall d'un grafic.
 *
 * `role="img"` amb una descripcio: un grafic sense text alternatiu no diu res
 * a qui fa servir un lector de pantalla. La taula que sol anar-hi al costat es
 * la versio llegible de les mateixes dades.
 */
function Chart({
  type,
  id,
  titol,
  descripcio,
  data,
  alçada = 260,
}: {
  type: string;
  id: string;
  titol: string;
  descripcio: string;
  data: unknown;
  alçada?: number;
}): Html {
  return html`<section class="superficie targeta">
    <h2>${titol}</h2>
    <div
      data-grafic="${type}"
      id="${id}"
      class="grafic"
      style="--alçada:${String(alçada)}px"
      role="img"
      aria-label="${descripcio}"
    >
      ${jsonScript(`${id}-dades`, data)}
    </div>
  </section>` as Html;
}

/**
 * Els imports es converteixen a `number` aqui, no als serveis.
 *
 * `PuntMensual`, `TrosCategoria`, `PuntSaldo`, `TrosComerc` i `PuntPrevisio`
 * son `MoneyString`: la mateixa fila serveix per a `formatMoney()` a les
 * taules (`TaulaCategories`, `TaulaEsdeveniments`, la pagina de previsio) i
 * per al grafic. Canviar el tipus del servei per fer content el grafic hauria
 * trencat aquelles taules —`formatMoney()` no accepta `number`. El grafic es
 * l'unic que necessita `number`, aixi que es ell qui el demana, amb
 * `toChartNumber()`.
 */
export function MonthlyChart(data: MonthlyPoint[]): Html {
  return Chart({
    type: "mensual",
    id: "grafic-mensual",
    titol: "Mes a mes",
    descripcio: "Ingressos, despeses fixes i variables, i resultat de cada mes",
    data: data.map((d) => ({
      periode: d.periode,
      income: toChartNumber(d.income),
      despesesFixes: toChartNumber(d.despesesFixes),
      despesesVariables: toChartNumber(d.despesesVariables),
      cleaned: toChartNumber(d.cleaned),
    })),
  });
}

export function CategoryChart(data: CategoryPart[]): Html {
  return Chart({
    type: "categories",
    id: "grafic-categories",
    titol: "On van les despeses",
    descripcio: "Repartiment de la despesa per categoria",
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
    titol: "Evolucio del saldo",
    descripcio: "Saldo dia a dia, reconstruit cap enrere des del saldo d'avui",
    data: data.map((d) => ({ day: d.day, balance: toChartNumber(d.balance) })),
  });
}

export function MerchantChart(data: MerchantPart[]): Html {
  return Chart({
    type: "comercos",
    id: "grafic-comercos",
    titol: "On es gasta mes",
    descripcio: "Els comerços amb mes despesa",
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
    titol: "Saldo previst",
    descripcio: `Saldo real dels darrers ${forecast.horitzoDies} dies i projeccio a ${forecast.horitzoDies} dies`,
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
        tendencia: toChartNumber(p.tendencia),
      })),
      llindar: toChartNumber(forecast.llindar),
      firstOverdraft: forecast.firstOverdraft,
      billDays,
    },
    alçada: 320,
  });
}

// --- Xifres ----------------------------------------------------------------

export interface StatProps {
  tag: string;
  valor: string;
  detail?: Html | string;
  to?: "positiu" | "negatiu" | "";
  href?: string;
}

export function Stat({ tag, valor, detail, to = "", href }: StatProps): Html {
  const body = html`<span class="xifra-etiqueta">${tag}</span>
    <strong class="xifra-valor ${to}">${valor}</strong>
    ${detail ? html`<small class="text-suau">${detail}</small>` : ""}`;

  return href
    ? (html`<a class="xifra xifra-enllac" href="${href}">${body}</a>` as Html)
    : (html`<div class="xifra">${body}</div>` as Html);
}

// --- Taules llegibles ------------------------------------------------------

/**
 * La mateixa informacio del grafic, en text.
 *
 * No es un extra: es el que fa que la pagina serveixi sense JavaScript i el
 * que pot llegir un lector de pantalla.
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
 * El saldo de la capçalera del panell.
 *
 * **No es cap objectiu fora de banda**, tot i que `AGENTS.md` ho deia:
 * sincronitzar es fa des de `/connexions`, una pagina d'administracio sense
 * cap espai concret, i el saldo viu al panell d'un espai (`/e/:codi`) —dues
 * pagines que no coincideixen mai al DOM del navegador. No hi ha cap mutacio
 * al panell mateix que l'hagi de refrescar sense recarregar. Es veu al dia
 * perque **cada cop que es carrega el panell es torna a calcular**.
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
