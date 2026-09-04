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
export function EstatBuit(missatge: Html | string): Html {
  return html`<p class="buit text-suau">${missatge}</p>` as Html;
}

export interface TaulaDadesProps {
  /** Les cel·les de la capçalera, ja dibuixades: `<th>…</th><th>…</th>`. */
  columnes: Html;
  files: Html[];
  /** El que es veu si `files` es buida. */
  buit: Html | string;
  /** Sobre la taula: una barra d'accions… Nomes surt si hi ha files. */
  abans?: Html | "";
  /** Sota la taula: la paginacio, un resum… Nomes surt si hi ha files. */
  peu?: Html | "";
  /** Classe de mes per a la `<table>`, quan una vista en te de propies. */
  classe?: string;
}

/**
 * Una taula de dades amb el seu estat buit.
 *
 * El que va abans i el que va despres nomes surten quan hi ha files: ni una
 * barra per triar-ne cap ni paginar el no-res volen dir res.
 */
export function TaulaDades({
  columnes,
  files,
  buit,
  abans = "",
  peu = "",
  classe,
}: TaulaDadesProps): Html {
  if (files.length === 0) return EstatBuit(buit);

  return html`${abans}
    <div class="desplaçable">
      <table class="dades${classe === undefined ? "" : ` ${classe}`}">
        <thead>
          <tr>
            ${columnes}
          </tr>
        </thead>
        <tbody>
          ${files}
        </tbody>
      </table>
    </div>
    ${peu}` as Html;
}

export interface Pagina {
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
export function Paginacio({
  pagina,
  passos,
  resum = "",
}: {
  pagina: Pagina;
  passos: Html | "";
  /** Al costat del rang: una suma, un recompte… */
  resum?: Html | "";
}): Html {
  const desde = pagina.total === 0 ? 0 : pagina.offset + 1;
  const fins = Math.min(pagina.offset + pagina.limit, pagina.total);

  return html`<nav class="paginacio" aria-label="Paginacio">
    <span class="text-suau">
      ${String(desde)}–${String(fins)} de ${String(pagina.total)}${resum}
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
export function Etiqueta(text: string, opcions: { suau?: boolean; titol?: string } = {}): Html {
  const classe = opcions.suau === true ? "etiqueta etiqueta-suau" : "etiqueta";
  return html`<span
    class="${classe}"
    ${opcions.titol === undefined ? "" : html`title="${opcions.titol}"`}
    >${text}</span
  >` as Html;
}
