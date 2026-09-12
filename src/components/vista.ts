/**
 * Les peces amb que es dibuixa una llista.
 *
 * Deu fragments duien la mateixa closca escrita a ma —un `div.desplaçable`,
 * una `table.dades`, i un `p.buit` per quan no hi havia res— i per tant deu
 * ocasions de fer-la lleugerament diferent.
 *
 * **L'estat buit i les files van juntes a proposit.** Escrites per separat,
 * qui dibuixa les files pot oblidar-se de l'avis, i aixo passava: esborrar
 * l'ultima fila d'una llista deixava una taula amb la capçalera i el cos
 * buit, sense dir enlloc que no hi havia res. Aqui no es pot: no hi ha cap
 * manera de demanar les files sense dir tambe que s'ha de veure si no n'hi ha.
 */

import { html } from "hono/html";

import type { Html } from "../lib/html.ts";

/** El que es veu quan una llista no te res. */
export function EmptyState(message: Html | string): Html {
  return html`<p class="buit text-suau">${message}</p>` as Html;
}

export interface DataTableProps {
  /** Les cel·les de la capçalera, ja dibuixades: `<th>…</th><th>…</th>`. */
  columnes: Html;
  rows: Html[];
  /** El que es veu si `files` es buida. */
  empty: Html | string;
  /** Sobre la taula: una barra d'accions… Nomes surt si hi ha files. */
  abans?: Html | "";
  /** Sota la taula: la paginacio, un resum… Nomes surt si hi ha files. */
  peu?: Html | "";
  /** Classe de mes per a la `<table>`, quan una vista en te de propies. */
  cssClass?: string;
}

/**
 * Una taula de dades amb el seu estat buit.
 *
 * El que va abans i el que va despres nomes surten quan hi ha files: ni una
 * barra per triar-ne cap ni paginar el no-res volen dir res.
 */
export function DataTable({
  columnes,
  rows,
  empty,
  abans = "",
  peu = "",
  cssClass,
}: DataTableProps): Html {
  if (rows.length === 0) return EmptyState(empty);

  return html`${abans}
    <div class="desplaçable">
      <table class="dades${cssClass === undefined ? "" : ` ${cssClass}`}">
        <thead>
          <tr>
            ${columnes}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${peu}` as Html;
}

export interface Page {
  total: number;
  limit: number;
  offset: number;
}

/**
 * «31–60 de 214», amb els botons d'anar amunt i avall.
 *
 * El rang es calcula aqui i no a cada fragment: una de les dues copies deia
 * «1–0 de 0» amb la llista buida, perque comptava des de `offset + 1` sense
 * mirar el total.
 */
export function Pagination({
  page,
  passos,
  summary = "",
}: {
  page: Page;
  passos: Html | "";
  /** Al costat del rang: una suma, un recompte… */
  summary?: Html | "";
}): Html {
  const desde = page.total === 0 ? 0 : page.offset + 1;
  const fins = Math.min(page.offset + page.limit, page.total);

  return html`<nav class="paginacio" aria-label="Paginacio">
    <span class="text-suau">
      ${String(desde)}–${String(fins)} de ${String(page.total)}${summary}
    </span>
    ${passos}
  </nav>` as Html;
}

/**
 * Una etiqueta petita al costat d'un nom.
 *
 * El titol es dibuixa amb una plantilla imbricada i no amb `raw()`: el text
 * pot venir d'una fila de la base de dades, i una cometa el trencaria a fora
 * de l'atribut.
 */
export function Badge(text: string, options: { suau?: boolean; titol?: string } = {}): Html {
  const cssClass = options.suau === true ? "etiqueta etiqueta-suau" : "etiqueta";
  return html`<span
    class="${cssClass}"
    ${options.titol === undefined ? "" : html`title="${options.titol}"`}
    >${text}</span
  >` as Html;
}

/**
 * El filador que surt mentre una peticio corre.
 *
 * Es dibuixa sempre i el fa visible HTMX, que posa `.htmx-request` a
 * l'element que digui l'`hx-indicator` mentre dura la peticio; el full
 * d'estil ja el treu i el torna amb una transicio.
 *
 * Les dues classes que el dibuixen —`.filador` i `.htmx-indicator`, amb el
 * seu `prefers-reduced-motion`— eren al full d'estil des del primer dia i no
 * les feia servir **cap** plantilla: classificar cinquanta moviments de cop
 * o moure un compte de tres-cents no donaven cap senyal de res, i les
 * accions es podien tornar a prémer mentre la primera encara corria.
 *
 * `aria-hidden`: qui no hi veu no en treu res, d'una roda que gira. Qui ho
 * necessita saber ho sabra pel boto, que queda desactivat.
 */
export function Spinner(): Html {
  return html`<span class="filador htmx-indicator" aria-hidden="true"></span>` as Html;
}
