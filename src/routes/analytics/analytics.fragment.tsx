/**
 * Fragments de les analitiques.
 *
 * Els grafics son **illes**: el servidor escriu les dades dins d'un
 * `<script type="application/json">` i `public/grafics.js` les dibuixa. No hi
 * ha cap estat de client ni cap empaquetador; si el JavaScript no arriba, es
 * veu un buit i la resta de la pagina (les taules, les xifres) continua
 * funcionant.
 */

import { html, raw } from "hono/html";

import { TaulaDades } from "../../components/vista.tsx";
import type { Html } from "../../lib/html.ts";
import { jsonScript } from "../../lib/http.ts";
import { formatMoney } from "../../lib/money.ts";
import { formatDate } from "../../lib/time.ts";
import type { PuntSaldo } from "../../services/balances.ts";
import type { Previsio } from "../../services/forecast.ts";
import type { PuntMensual, TrosCategoria, TrosComerc } from "../../services/reports.ts";

/**
 * L'embolcall d'un grafic.
 *
 * `role="img"` amb una descripcio: un grafic sense text alternatiu no diu res
 * a qui fa servir un lector de pantalla. La taula que sol anar-hi al costat es
 * la versio llegible de les mateixes dades.
 */
function Grafic({
  tipus,
  id,
  titol,
  descripcio,
  dades,
  alçada = 260,
}: {
  tipus: string;
  id: string;
  titol: string;
  descripcio: string;
  dades: unknown;
  alçada?: number;
}): Html {
  return html`<section class="superficie targeta">
    <h2>${titol}</h2>
    <div
      data-grafic="${tipus}"
      id="${id}"
      class="grafic"
      style="height:${String(alçada)}px"
      role="img"
      aria-label="${descripcio}"
    >
      ${jsonScript(`${id}-dades`, dades)}
    </div>
  </section>` as Html;
}

export function GraficMensual(dades: PuntMensual[]): Html {
  return Grafic({
    tipus: "mensual",
    id: "grafic-mensual",
    titol: "Mes a mes",
    descripcio: "Ingressos, despeses i resultat de cada mes",
    dades,
  });
}

export function GraficCategories(dades: TrosCategoria[]): Html {
  return Grafic({
    tipus: "categories",
    id: "grafic-categories",
    titol: "On van les despeses",
    descripcio: "Repartiment de la despesa per categoria",
    dades,
  });
}

export function GraficSaldos(dades: PuntSaldo[]): Html {
  return Grafic({
    tipus: "saldos",
    id: "grafic-saldos",
    titol: "Evolucio del saldo",
    descripcio: "Saldo dia a dia, reconstruit cap enrere des del saldo d'avui",
    dades,
  });
}

export function GraficComercos(dades: TrosComerc[]): Html {
  return Grafic({
    tipus: "comercos",
    id: "grafic-comercos",
    titol: "On es gasta mes",
    descripcio: "Els comerços amb mes despesa",
    dades,
    alçada: 320,
  });
}

export function GraficPrevisio(previsio: Previsio): Html {
  return Grafic({
    tipus: "previsio",
    id: "grafic-previsio",
    titol: "Saldo previst",
    descripcio: `Projeccio del saldo a ${previsio.horitzoDies} dies, en banda optimista, esperada i pessimista`,
    dades: { punts: previsio.punts, llindar: previsio.llindar },
    alçada: 320,
  });
}

// --- Xifres ----------------------------------------------------------------

export interface XifraProps {
  etiqueta: string;
  valor: string;
  detall?: Html | string;
  to?: "positiu" | "negatiu" | "";
  href?: string;
}

export function Xifra({ etiqueta, valor, detall, to = "", href }: XifraProps): Html {
  const cos = html`<span class="xifra-etiqueta">${etiqueta}</span>
    <strong class="xifra-valor ${to}">${valor}</strong>
    ${detall ? html`<small class="text-suau">${detall}</small>` : ""}`;

  return href
    ? (html`<a class="xifra xifra-enllac" href="${href}">${cos}</a>` as Html)
    : (html`<div class="xifra">${cos}</div>` as Html);
}

// --- Taules llegibles ------------------------------------------------------

/**
 * La mateixa informacio del grafic, en text.
 *
 * No es un extra: es el que fa que la pagina serveixi sense JavaScript i el
 * que pot llegir un lector de pantalla.
 */
export function TaulaCategories(dades: TrosCategoria[]): Html {
  return TaulaDades({
    columnes: html`<th>Categoria</th>
      <th class="dreta">Import</th>
      <th class="dreta">Part</th>
      <th class="dreta">Moviments</th>` as Html,
    files: dades.map(
      (tros) =>
        html`<tr>
          <td>
            <span class="punt" style="background:${tros.color}" aria-hidden="true"></span>
            ${tros.categoryName}
          </td>
          <td class="dreta">${formatMoney(tros.amount)}</td>
          <td class="dreta">${String(Math.round(tros.share * 100))}%</td>
          <td class="dreta">${String(tros.transactions)}</td>
        </tr>` as Html,
    ),
    buit: "Encara no hi ha despeses classificades.",
  });
}

export function TaulaEsdeveniments(previsio: Previsio): Html {
  return TaulaDades({
    columnes: html`<th>Dia</th>
      <th>Rebut</th>
      <th class="dreta">Import</th>` as Html,
    files: previsio.esdeveniments.map(
      (e) =>
        html`<tr>
          <td><time datetime="${e.dia}">${formatDate(e.dia)}</time></td>
          <td>${e.label}</td>
          <td class="dreta ${e.amount.startsWith("-") ? "negatiu" : "positiu"}">
            ${formatMoney(e.amount)}
          </td>
        </tr>` as Html,
    ),
    buit: "No hi ha cap rebut previst dins d'aquest horitzo.",
  });
}

/** El saldo de la capçalera del panell: objectiu fora de banda. */
export function SaldoCapcalera({
  saldo,
  data,
  oob = false,
}: {
  saldo: string;
  data: string | null;
  oob?: boolean;
}): Html {
  return html`<div id="saldo-capcalera" class="xifra" ${oob ? raw('hx-swap-oob="true"') : ""}>
    <span class="xifra-etiqueta">Saldo</span>
    <strong class="xifra-valor">${formatMoney(saldo)}</strong>
    <small class="text-suau">
      ${data ? html`a ${formatDate(data)}` : "encara no s'ha importat cap saldo"}
    </small>
  </div>` as Html;
}
