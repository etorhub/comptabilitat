/**
 * Una llista sense files ha de dir que no n'hi ha cap.
 *
 * Sembla obvi i no ho era: cada fragment duia la seva closca de taula
 * escrita a ma, amb l'avis de «no hi ha res» en una branca a part, i les
 * rutes d'esborrar tornaven **nomes la fila** —un `<tr hidden>`— de manera
 * que treure l'ultima deixava una capçalera de taula sobre un cos buit, per
 * sempre, sense dir enlloc que la llista s'havia acabat. Es veia a les
 * regles, i el mateix cami hi havia als avisos.
 *
 * Ara les files i l'estat buit els dibuixa la mateixa funcio, que es
 * l'unica manera d'evitar que tornin a separar-se.
 */

import { describe, expect, test } from "bun:test";
import { html } from "hono/html";

import { EmptyState, Pagination, DataTable } from "../../src/components/vista.ts";
import type { Html } from "../../src/lib/html.ts";

const COLUMNES = html`<th>Nom</th>
  <th>Valor</th>` as Html;

function text(node: Html): string {
  return String(node);
}

describe("TaulaDades", () => {
  test("sense files no dibuixa cap taula, nomes l'avis", () => {
    const output = text(
      DataTable({ columnes: COLUMNES, rows: [], empty: "Aqui no hi ha res." }),
    );

    expect(output).toContain("Aqui no hi ha res.");
    expect(output).toContain('class="buit text-suau"');
    expect(output).not.toContain("<table");
    expect(output).not.toContain("<thead");
  });

  test("amb files dibuixa la taula i no l'avis", () => {
    const output = text(
      DataTable({
        columnes: COLUMNES,
        rows: [
          html`<tr id="fila-1">
          <td>u</td>
        </tr>` as Html,
        ],
        empty: "Aqui no hi ha res.",
      }),
    );

    expect(output).toContain('<table class="dades">');
    expect(output).toContain('id="fila-1"');
    expect(output).not.toContain("Aqui no hi ha res.");
  });

  test("el que va abans i el peu nomes surten si hi ha files", () => {
    const props = {
      columnes: COLUMNES,
      empty: "Res.",
      abans: html`<div id="barra"></div>` as Html,
      peu: html`<div id="peu"></div>` as Html,
    };

    const withRows = text(DataTable({ ...props, rows: [html`<tr></tr>` as Html] }));
    expect(withRows).toContain('id="barra"');
    expect(withRows).toContain('id="peu"');

    // Ni una barra per triar files que no hi son ni paginar el no-res.
    const without = text(DataTable({ ...props, rows: [] }));
    expect(without).not.toContain('id="barra"');
    expect(without).not.toContain('id="peu"');
  });

  test("la classe de mes s'afegeix a la de sempre", () => {
    const output = text(
      DataTable({
        columnes: COLUMNES,
        rows: [html`<tr></tr>` as Html],
        empty: "Res.",
        cssClass: "taula-moviments",
      }),
    );
    expect(output).toContain('<table class="dades taula-moviments">');
  });
});

describe("Paginacio", () => {
  test("amb la llista buida compta des de zero", () => {
    // La copia dels comerços deia «1–0 de 0»: sumava 1 a l'offset sense
    // mirar si hi havia res.
    const output = text(Pagination({ page: { total: 0, limit: 50, offset: 0 }, passos: "" }));
    expect(output).toContain("0–0 de 0");
  });

  test("dona el rang de la pagina que toca", () => {
    const output = text(
      Pagination({ page: { total: 214, limit: 30, offset: 30 }, passos: "" }),
    );
    expect(output).toContain("31–60 de 214");
  });

  test("l'ultima pagina no passa del total", () => {
    const output = text(
      Pagination({ page: { total: 214, limit: 30, offset: 210 }, passos: "" }),
    );
    expect(output).toContain("211–214 de 214");
  });
});

describe("EstatBuit", () => {
  test("escapa el text que li donen", () => {
    expect(text(EmptyState("<script>alert(1)</script>"))).not.toContain("<script>");
  });
});
