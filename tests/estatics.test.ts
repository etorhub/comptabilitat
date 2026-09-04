/**
 * Memòria cau dels fitxers estàtics.
 *
 * Sense `Cache-Control` i sense `?v=`, cada càrrega de pàgina tornava a
 * baixar HTMX, ECharts i el CSS. Aquestes proves tanquen les dues meitats:
 * la capçalera que el navegador respectarà, i la versió a l'HTML perquè un
 * desplegament no deixi bytes vells un any.
 */

import { describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { hrefEstatic } from "../src/lib/estatics.ts";

describe("estatics", () => {
  test("GET /htmx.min.js duu Cache-Control immutable", async () => {
    const res = await app.request("/htmx.min.js");
    expect(res.status).toBe(200);
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("max-age=31536000");
    expect(cache).toContain("immutable");
  });

  test("GET /entrada enllaça els estàtics amb ?v=", async () => {
    const res = await app.request("/entrada");
    expect(res.status).toBe(200);
    const html = await res.text();
    // `app.css` es genera i pot no existir a la CI; el `?v=` hi ha de ser
    // igualment (amb resum o amb el marcador `absent`).
    expect(html).toContain("app.css?v=");
    expect(html).toContain(hrefEstatic("htmx.min.js"));
    expect(html).toMatch(/htmx\.min\.js\?v=[0-9a-f]{8}/);
  });
});
