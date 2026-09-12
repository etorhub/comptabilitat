/**
 * Static file caching.
 *
 * Without `Cache-Control` and without `?v=`, every page load downloaded HTMX,
 * ECharts and the CSS again. These tests close both halves: the header the
 * browser will respect, and the version in the HTML so that a deployment does
 * not leave old bytes for a year.
 */

import { describe, expect, test } from "bun:test";

import { app } from "../../src/server.ts";
import { staticHref } from "../../src/lib/static-files.ts";

describe("static files", () => {
  test("GET /htmx.min.js carries Cache-Control immutable", async () => {
    const res = await app.request("/htmx.min.js");
    expect(res.status).toBe(200);
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("max-age=31536000");
    expect(cache).toContain("immutable");
  });

  test("GET /entrada links the static files with ?v=", async () => {
    const res = await app.request("/entrada");
    expect(res.status).toBe(200);
    const html = await res.text();
    // `app.css` is generated and may not exist in CI; the `?v=` has to be
    // there anyway (with a digest or with the `absent` marker).
    expect(html).toContain("app.css?v=");
    expect(html).toContain(staticHref("htmx.min.js"));
    expect(html).toMatch(/htmx\.min\.js\?v=[0-9a-f]{8}/);
  });
});
