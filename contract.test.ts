/**
 * The rules that have no historical bug behind them yet, and the primitives
 * everything else is built on.
 *
 * `regressions.test.ts` holds the ones that do. The split is deliberate: those
 * are evidence, these are coverage.
 */

import { describe, expect, test } from "bun:test";

import { PAGE } from "./fixtures.ts";
import {
  applySwap,
  checkDocument,
  checkResponse,
  innerHtmlOf,
  inspect,
  outerHtmlOf,
  rootElement,
  withoutOob,
  type RuleName,
  type Violation,
} from "./index.ts";

function rules(violations: Violation[]): RuleName[] {
  return violations.map((v) => v.rule);
}

describe("dead-target", () => {
  test("a target that is not in the page is caught", async () => {
    const found = await checkDocument(
      `<!doctype html><html><body>
        <button hx-post="/x" hx-target="#no-hi-es" hx-swap="outerHTML">Va</button>
      </body></html>`,
    );
    expect(rules(found)).toContain("dead-target");
  });

  test("a target that is in the page is not", async () => {
    const found = await checkDocument(
      `<!doctype html><html><body>
        <div id="hi-es"></div>
        <button hx-post="/x" hx-target="#hi-es" hx-swap="outerHTML">Va</button>
      </body></html>`,
    );
    expect(rules(found)).not.toContain("dead-target");
  });

  test("relative targets are left alone: they need a DOM to resolve", async () => {
    for (const target of ["this", "closest tr", "find .x", "next", "previous", "body"]) {
      const found = await checkDocument(
        `<!doctype html><html><body><button hx-post="/x" hx-target="${target}"></button></body></html>`,
      );
      expect(rules(found)).not.toContain("dead-target");
    }
  });

  test("a fragment's targets are not judged without its page", async () => {
    const found = await checkDocument(
      `<button hx-post="/x" hx-target="#en-la-pagina"></button>`,
      {
        fragment: true,
      },
    );
    expect(rules(found)).not.toContain("dead-target");
  });

  test("knownIds vouches for an id rendered elsewhere", async () => {
    const found = await checkDocument(
      `<!doctype html><html><body><button hx-post="/x" hx-target="#mes-tard"></button></body></html>`,
      { knownIds: ["mes-tard"] },
    );
    expect(rules(found)).not.toContain("dead-target");
  });
});

describe("dead-oob", () => {
  test("an out-of-band node aimed at nothing is caught", async () => {
    const found = await checkResponse({
      page: PAGE,
      response: `<div hx-swap-oob="innerHTML:#no-hi-es">hola</div>`,
      target: "#moviment-1",
    });
    expect(rules(found)).toContain("dead-oob");
  });

  test("one aimed at a real id is not", async () => {
    const found = await checkResponse({
      page: PAGE,
      response: `<div hx-swap-oob="innerHTML:#toast">hola</div>`,
      target: "#moviment-1",
      headers: { "HX-Reswap": "none" },
    });
    expect(rules(found)).not.toContain("dead-oob");
  });

  test('hx-swap-oob="true" with no id has nowhere to land', async () => {
    const found = await checkResponse({
      page: PAGE,
      response: `<div hx-swap-oob="true">hola</div>`,
      target: "#moviment-1",
      headers: { "HX-Reswap": "none" },
    });
    expect(rules(found)).toContain("dead-oob");
  });

  test('hx-swap-oob="true" uses the node\'s own id as its target', async () => {
    const found = await checkResponse({
      page: PAGE,
      response: `<span id="comptador-revisio" hx-swap-oob="true">3</span>`,
      target: "#moviment-1",
      headers: { "HX-Reswap": "none" },
    });
    expect(rules(found)).not.toContain("dead-oob");
  });
});

describe("inspect", () => {
  test("reads ids, hx attributes, fields and polls", async () => {
    const snapshot = await inspect(
      `<form><input name="a"><input name="b"></form>
       <div id="x" hx-get="/y" hx-trigger="every 3s" data-poll-max="10"></div>`,
    );
    expect([...snapshot.ids.keys()]).toEqual(["x"]);
    expect(snapshot.fields.map((f) => f.name)).toEqual(["a", "b"]);
    expect(snapshot.fields.every((f) => f.formIndex === 0)).toBe(true);
    expect(snapshot.polls).toHaveLength(1);
    expect(snapshot.polls[0]?.everyMs).toBe(3000);
    expect(snapshot.polls[0]?.bounded).toBe(true);
  });

  test("fields in different forms do not share a form index", async () => {
    const snapshot = await inspect(
      `<form><input name="q"></form><form><input name="q"></form>`,
    );
    expect(snapshot.fields.map((f) => f.formIndex)).toEqual([0, 1]);
    // Which is why this is not a collision.
    const found = await checkDocument(
      `<form><input name="q"></form><form><input name="q"></form>`,
      { fragment: true },
    );
    expect(rules(found)).not.toContain("duplicate-field-in-form");
  });

  test("a nested form's fields belong to the innermost open form", async () => {
    const snapshot = await inspect(`<form><div><input name="q"></div></form><input name="q">`);
    expect(snapshot.fields.map((f) => f.formIndex)).toEqual([0, null]);
  });

  test("detects a whole page versus a fragment", async () => {
    expect((await inspect(PAGE)).standalone).toBe(true);
    expect((await inspect(`<tr id="a"></tr>`)).standalone).toBe(false);
  });
});

describe("extraction keeps the document's own bytes", () => {
  const doc = `<div hx-swap-oob="innerHTML:#toast"><p class="x">Boom &amp; co</p></div>`;

  test("outer", async () => {
    expect(await outerHtmlOf(doc, "[hx-swap-oob]")).toBe(doc);
  });

  test("inner", async () => {
    expect(await innerHtmlOf(doc, "[hx-swap-oob]")).toBe(`<p class="x">Boom &amp; co</p>`);
  });

  test("entities are not re-encoded and attribute order is not shuffled", async () => {
    const gnarly = `<a data-z="1" class='q' href="/x?a=1&amp;b=2">&lt;ok&gt;</a>`;
    expect(await outerHtmlOf(gnarly, "a")).toBe(gnarly);
  });

  test("withoutOob leaves everything else alone", async () => {
    const mixed = `<tr id="r"><td>fila</td></tr><div hx-swap-oob="true" id="t"></div>`;
    expect((await withoutOob(mixed)).trim()).toBe(`<tr id="r"><td>fila</td></tr>`);
  });

  test("rootElement finds the first element, not the first tag in a string", async () => {
    expect(await rootElement(`  <tr id="r"><td>x</td></tr>`)).toEqual({ tag: "tr", id: "r" });
    expect(await rootElement(`text only`)).toBeNull();
  });
});

describe("applySwap models htmx's response handling", () => {
  test("out-of-band nodes land by id, wherever they sit in the body", async () => {
    const { html } = await applySwap({
      page: PAGE,
      response: `<tr id="moviment-1"><td>nova</td></tr><span id="comptador-revisio" hx-swap-oob="true">7</span>`,
      target: "#moviment-1",
      swap: "outerHTML",
    });
    expect(html).toContain("nova");
    expect(html).toContain(`<span id="comptador-revisio" hx-swap-oob="true">7</span>`);
  });

  test("HX-Retarget wins over the trigger's target", async () => {
    const { target, html } = await applySwap({
      page: PAGE,
      response: `<td>canviada</td>`,
      target: "#moviment-1",
      swap: "innerHTML",
      headers: { "HX-Retarget": "#moviment-2" },
    });
    expect(target).toBe("#moviment-2");
    expect(html).toContain(`<tr id="moviment-2"><td>canviada</td></tr>`);
    expect(html).toContain(`<tr id="moviment-1"><td>Una fila</td></tr>`);
  });

  test("innerHTML is the default when no swap is given, as in htmx", async () => {
    const { swap } = await applySwap({
      page: PAGE,
      response: `<td>x</td>`,
      target: "#moviment-1",
    });
    expect(swap).toBe("innerHTML");
  });

  test("stock htmx does not swap a 4xx; this application opts in", async () => {
    const stock = await applySwap({
      page: PAGE,
      response: `<td>x</td>`,
      status: 422,
      target: "#moviment-1",
      allowErrorSwap: false,
    });
    expect(stock.swapped).toBe(false);
    expect(stock.html).toBe(PAGE);

    const optedIn = await applySwap({
      page: PAGE,
      response: `<td>x</td>`,
      status: 422,
      target: "#moviment-1",
    });
    expect(optedIn.swapped).toBe(true);
  });

  test("every swap style does what it says", async () => {
    const page = `<div id="t"><em>vell</em></div>`;
    const cases: [string, string][] = [
      ["innerHTML", `<div id="t"><b>nou</b></div>`],
      ["outerHTML", `<b>nou</b>`],
      ["beforeend", `<div id="t"><em>vell</em><b>nou</b></div>`],
      ["afterbegin", `<div id="t"><b>nou</b><em>vell</em></div>`],
      ["beforebegin", `<b>nou</b><div id="t"><em>vell</em></div>`],
      ["afterend", `<div id="t"><em>vell</em></div><b>nou</b>`],
      ["delete", ``],
    ];
    for (const [style, expected] of cases) {
      const { html } = await applySwap({
        page,
        response: `<b>nou</b>`,
        target: "#t",
        swap: style,
      });
      expect(html).toBe(expected);
    }
  });
});
