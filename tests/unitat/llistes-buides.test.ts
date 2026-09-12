/**
 * A list with no rows has to say there are none.
 *
 * It looks obvious and it was not: each fragment carried its own table shell
 * written by hand, with the «there is nothing» notice in a separate branch,
 * and the delete routes returned **only the row** —a `<tr hidden>`— so that
 * removing the last one left a table header over an empty body, forever,
 * without saying anywhere that the list had run out. It could be seen in the
 * rules, and the alerts had the same path.
 *
 * Now the rows and the empty state are drawn by the same function, which is
 * the only way to stop them separating again.
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

    // No bar for selecting rows that are not there and no paginating nothing.
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
    // The merchants' copy said «1–0 of 0»: it added 1 to the offset without
    // looking at whether there was anything.
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
