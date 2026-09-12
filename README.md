# htmx-contract

Checks the seam between the HTML a route returns and the DOM that receives it.

In an htmx application that seam is a string on one side and a browser on the
other, so nothing checks it. `hx-target="#row-7"` is text. A type checker cannot
tell you the target is gone; a linter cannot tell you the response body empties
itself once the out-of-band nodes are lifted out; a test that asserts on a
response body cannot tell you the swap deletes the element the user was
touching. Each of those shipped at least once in the application this was built
for, and each was found by a person in a browser, counting rows.

Zero dependencies. Built on Bun's `HTMLRewriter`. Knows nothing about the
application it is checking, and imports nothing from it.

## Install

```bash
bun add -d htmx-contract
```

Bun only, for now: it is built on Bun's `HTMLRewriter`.

## Use

```ts
import { checkDocument, checkResponse, swapAndCheck, formatViolations } from "htmx-contract";

// Is this rendered page self-consistent?
const onPage = await checkDocument(html);

// Would this response, swapped into that page, do damage?
const onResponse = await checkResponse({
  page,
  response: await res.text(),
  headers: res.headers,
  status: res.status,
  target: "#moviment-1",
  swap: "outerHTML",
});

// Assert on the page *after* the interaction, not on the response body.
const { html: after, violations } = await swapAndCheck({ /* same shape */ });
expect(after).toContain("No hi ha cap regla.");
```

## The rules

| Rule                      | What it catches                                                                                                                                                                | Bug it came from |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `empty-after-oob`         | A response that is empty once its out-of-band nodes are removed, without `HX-Reswap: none`. htmx swaps that emptiness into the target; with `outerHTML` the target is deleted. | `e5dd962`        |
| `duplicate-id`            | The same id twice in one document. htmx swaps the first match.                                                                                                                 | `f5b8e9b`        |
| `duplicate-field-in-form` | Two controls sharing a `name` inside one `<form>`. htmx sends all of them and lets the form's values override the element's own.                                               | `f5b8e9b`        |
| `target-identity-lost`    | An `outerHTML` swap returning markup without the target's id. Works once, then the element is unaddressable.                                                                   | `da64cb1`        |
| `unbounded-poll`          | `hx-trigger="every …"` with no declared bound. A poll that only stops on a terminal state never stops if the work dies without reaching one.                                   | `f80df91`        |
| `dead-target`             | `hx-target="#x"` where `#x` is not in the document.                                                                                                                            | —                |
| `dead-oob`                | An out-of-band node whose target is not in the page, or which names no target at all. htmx drops it silently.                                                                  | —                |

Each rule is tested against the markup of the bug it came from, in
`regressions.test.ts`. That is the point of keeping the fixtures: **a rule that
passes its own bug is decoration**, and the only way to know is to keep the bug
around.

## What is modelled, and what is not

`swap.ts` is **a model of htmx 2, not htmx**. It reproduces the response path:

- `hx-swap-oob` extraction before the main swap
- `hx-swap-oob` values: `true`, a bare swap style, and `<style>:<selector>`
- `HX-Reswap` overriding `hx-swap`, including `none`
- `HX-Retarget` overriding `hx-target`
- swap styles: `innerHTML`, `outerHTML`, `textContent`, `beforebegin`,
  `afterbegin`, `beforeend`, `afterend`, `delete`, `none`
- the default swap style, `innerHTML`, when none is given
- 4xx responses swapping only because the application opts in
  (`allowErrorSwap`, default true — this application's layout enables it via
  `htmx:beforeSwap`, because its errors arrive as a toast inside a 4xx)

It does **not** model, and cannot catch:

- CSS and layout — a swap that lands correctly and looks wrong
- whether the application's own `htmx:beforeSwap` / `htmx:afterSwap` handlers
  actually run, or what they do
- settling, transitions, focus, scroll, or `hx-preserve`
- the ECharts island lifecycle, or any client-side script
- `hx-boost`, history and the back button
- extended target selectors (`closest`, `find`, `next`, `previous`, `this`),
  which need a real DOM — `dead-target` skips them rather than guessing
- any divergence between this model and htmx's real algorithm

That last one is the honest risk. The list above is the contract: when
`public/htmx.min.js` is bumped, re-read `MODELLED` in `swap.ts` against the
release notes.

## Why no browser

A browser would catch the uncovered list too. It would also be the first
heavyweight dependency in a deliberately bundler-free project that has to run on
a NAS, and it would move the feedback loop from 30 milliseconds to tens of
seconds. The trade taken here is: catch the class of bug that has actually
shipped, in a tier fast enough that nobody is tempted to skip it, and write down
plainly what that leaves uncovered rather than implying the seam is now safe.

## Where it came from

This began as a directory inside a personal accounting application, written from
the start to be liftable: it imported nothing from the app, and a boundary check
in CI enforced that on every commit. It was split out with
`git subtree split`, so the five commits that explain why each rule exists came
with it — `git log` still answers "why does `duplicate-field-in-form` exempt
checkboxes?".

It is the checker for [PLEYN](https://github.com/etorhub/pleyn), a stack of
Bun, Hono, `hono/html`, htmx, Drizzle and PostgreSQL. It has no dependency on
any of that, though. If you return HTML and htmx swaps it, this applies.
