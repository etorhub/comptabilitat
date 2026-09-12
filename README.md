# PLEYN

*Middle English for **plain**.*

**Bun · Hono · `hono/html` · htmx · Drizzle · PostgreSQL · Zod · Tailwind**

Plain HTML, plain strings, nothing clever.

---

## The claim

The server renders HTML. htmx swaps in the piece that changed. There is no
bundler, no client router, no client state, and no JSON API for the browser.
Templates are the `html` tagged template — they return **strings**, which is
what makes a fragment testable without a browser and without a DOM.

None of that is new. Plenty of people build this way.

What PLEYN adds is one thing: **the seam between the HTML a route returns and
the DOM that receives it is checked statically, in under a second, with no
browser.**

## Why that matters

In a hypermedia application, that seam is a string on one side and a browser on
the other, so nothing checks it. `hx-target="#row-7"` is text. The type checker
can't tell you the target is gone. The linter can't tell you the response body
empties itself once the out-of-band nodes are lifted out. A test asserting on a
response body can't tell you the swap deletes the row the user was touching.

Four bugs shipped into the application this stack was extracted from. All four
were found by a person with a browser open, counting rows. Not one was caught by
`tsc`, by the linter, or by a route test that passed.

| What happened | Why nothing caught it |
| --- | --- |
| A 4xx carrying only a toast **deleted the row the user was touching** — in thirteen places, including the global error handler and the CSRF middleware, which fire on *any* mutation with an expired session | The body was empty after out-of-band extraction; no test modelled the swap |
| A `<form>` wrapping the table made every row ship `category_id`. Editing row 1 saved **row 50's** category — and stored it as a human decision, the one state the classifier never corrects | Route tests hand-build the body, so they never send what a browser sends |
| Deleting the last row left a table header over an empty body, forever | Rows and empty state were rendered in separate branches |
| An interrupted import polled every two seconds, indefinitely, for every viewer | The stop condition was "state is terminal"; nothing reached a terminal state |

The old defence was a line in the contributing docs: *open it in the browser*.
That is exactly the step that gets skipped — by a tired person on a Friday, and
by every coding agent that has ever existed.

So PLEYN moves that defence into `bun run check`.

## What you get

**[`htmx-contract`](https://github.com/etorhub/htmx-contract)** — seven rules and
a model of htmx's swap algorithm, so a test can assert on the DOM *after* an
interaction. Each rule is pinned against the markup of the bug it came from: a
rule that passes its own bug is decoration. Zero dependencies, knows nothing
about your application, works with any htmx backend.

**A conformance test** that walks every page through the checker, plus a
meta-test asserting every resource is enrolled. Adding a resource without an
entry fails CI — which is the only mechanism that survives contributors who
don't read the docs.

**Two declared test tiers.** The fast one runs in under a second with no
database, in a CI job with no database *service*, which is what keeps the
separation honest.

**Generated documentation.** The out-of-band target table drifted to listing
three when the code rendered thirteen — after a commit spent reconciling it. It
now comes out of a registry the components actually import, and CI fails when
they diverge. Documentation that lies is worse than none, because somebody
builds on it.

**Bounded polling.** The attempt counter travels in the polled URL, so it stays
server-authoritative with no client state, and the page gives up and says so
rather than asking forever.

## Why agents

A stack with no bundler, no client state and no indirection is a stack where an
average model — or a local one — can make a correct change. Locality of
behaviour isn't an aesthetic here; it's the reason the work is tractable at all
for something with a small context window.

The conventions exist so an agent can't quietly get it wrong: the four-file
resource rule, one Zod schema per resource derived from the table, out-of-band
targets that don't compile unless registered, and a single `bun run ok` that
says which step failed and what to do about it.

The honest version: this is a stack designed on the assumption that the person
touching the code next may not be a person, may not be excellent, and will not
open a browser.

## Status

Early. Day one, in fact.

- ✅ `htmx-contract` extracted, packaged, tests green
- ⬜ published to npm
- ⬜ a public reference application
- ⬜ a template repository
- ⬜ `create-pleyn`

The stack runs in production in a private application. Everything here is being
lifted out of it, which is why the doctrine exists before the demo does.

## Licence

MIT.
