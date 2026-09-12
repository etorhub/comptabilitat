# Why the rules are what they are

[`AGENTS.md`](../AGENTS.md) says **what** to do. This says **why**, and above all
what happened when it was not done.

They are two files on purpose. The rules have to be readable in full before you
touch anything; the reasons are only needed when a rule looks arbitrary or when
you are thinking of changing it. Mixed together, the file gets too long to read,
and then neither of the two gets read.

---

## Where this comes from

Until September 2026 this was a FastAPI API with a React interface in front of
it. Many files in `src/` say where they came from («a translation of
`backend/app/services/...`»): **those paths no longer exist**, they are in the
git history. They are there to say what was being translated and why a function
does what it does, not to be looked up.

When an earlier decision was not a good one, the comment says so. Nothing is
taken as correct just because it used to be: the Python application, for
instance, had **no** CSRF defense at all.

---

## The four bugs in the HTMX seam

These four explain half the rules, and all four were found by a person with a
browser open, counting rows. Not one was caught by `tsc`, by oxlint, or by a
route test.

Now `htmx-contract/` catches them: the markup of each one is kept in
`fixtures.ts` with a rule that fires on it. A rule that does not fail against its
own bug is decoration.

### `e5dd962` — an error took away the row you were touching

A 422 answered with a body carrying only the out-of-band `#toast`. HTMX takes
the nodes with `hx-swap-oob` out of the fragment and puts them in their place;
the fragment is then left **empty**, and HTMX does the main swap with that
emptiness inside the `hx-target`. Since `hx-swap="outerHTML"` is used
everywhere, the element disappeared.

Checked in the browser: forcing a 422 on a row took the table from 50 rows to 49. The toast did show, mind you. It happened in thirteen places, and the two
worst were the general ones: the server's `notFound` and `onError`, and the
three responses of the CSRF middleware, which fire on **any** mutation with an
expired session.

The cure is `HX-Reswap: none`, which means there is no main swap and lets the
out-of-band ones through all the same. That is what `toastOnly()` does.

### `f5b8e9b` — the table saved the category on the wrong row

The bulk selection's `<form>` wrapped the whole table, and every row carried its
category picker inside it with the same `name="category_id"`.

For any non-GET request, HTMX collects the values of the form surrounding the
element (`getInputValues`) and makes them win over the element's own value
(`overrideFormData`). Hono's `parseBody` keeps the last occurrence. Picking
«Habitatge» on the first row saved the last row's category there — and it was
left as `category_source = "user"`, the one state the classification never
corrects.

The cure is `hx-include`, which says exactly what gets sent. And `Field`/`Select`
accept an `id` of their own: until then every row drew `id="category_id"`, which
is invalid HTML and makes `aria-describedby` always point at the first one.

**Checkboxes and radio buttons are the exception.** Sharing a name is what they
are: five `<input type="checkbox" name="tipus">` are a multi-value filter, not a
collision. The rule learned that late, firing on every honest filter in the
application.

### `da64cb1` — deleting the last row left a header over nothing

The rows and the empty-list notice were written in separate branches, and
nothing forced the delete routes to respect the second. They returned **only the
row**, so removing the last rule left a table header over an empty body,
forever, without saying anywhere that the list had run out.

That is why `DataTable` asks for `rows` and `empty` together: **there is no way
to draw the one without also saying the other.**

### `f80df91` — an interrupted import polled forever

The fragment re-armed itself as long as the state was not terminal. A
`docker compose stop` halfway killed the process and the `sync_runs` row stayed
`running` forever: there is nobody who can finish it. The page went on asking
for it **every two seconds, indefinitely, for everyone who looked at it**.

The markup of a poll that will stop and of one that will never stop were
identical, and that is why nobody saw it coming. Now the limit is **declared**
(`data-poll-max`) and the attempt counter travels in the polled URL.

---

## Decisions that look arbitrary and are not

### The `#toast` changes its content, not its container

It uses `hx-swap-oob="innerHTML:#toast"` and not `="true"` like the rest. A live
region has to be announced by the browser when text enters it, and for that it
has to exist **beforehand**: if the whole node is replaced, what arrives is a
new node that was not yet a live region when it was filled. On top of that, the
replacement `#toast` carried no `aria-live`, so from the first toast on there was
no live region left for anyone.

### The header balance is not an out-of-band target

It was in an earlier version of this document. Synchronizing is done from
`/connexions`, an administration page with no particular workspace; the balance
lives in a workspace's dashboard (`/e/:codi`). They are two pages that **never
coexist in the DOM** with this kind of navigation — no web socket, no SSE — and
there is no mutation in the dashboard itself that has to refresh it without a
reload.

If one day there is SSE, this has to be rethought.

### The foreign keys are asymmetric

Deleting a category **deletes** the rules that assign it (`CASCADE`) but only
leaves the transactions without a category (`SET NULL`). A rule with no category
means nothing; a transaction with no category does.

### The enumerations are not native types

They are `varchar(32)` **with no CHECK constraint**. What guarantees the value is
`db/schema/enums.ts` and the matching Zod. The constraint names are Alembic's
(`pk_*`, `fk_*`, `uq_*`), written by hand: the schema in `src/db/schema/`
**describes the database that already exists**, and its last Alembic head is
`b2c3d4e5f6a7`.

### A `<select>` with `<optgroup>` for picking a category

The category plan is two levels and that is exactly what an `<optgroup>` knows
how to do: keyboard, type-ahead and accessibility, for free. It replaces the 372
lines of the React application's `SelectorCategoria`.

### `alerts` lets a `viewer` mark as read

Unlike the rest of the mutations, which require `editor`. It is kept as it was in
the Python (`routes/alerts.py:39,47`). It looks like an oversight, but tightening
it is a behavior change and has to be decided separately. **Still to be
decided.**

---

## Why the documentation is generated

The table of out-of-band targets listed **three** when the code already drew
**thirteen** — and that after a commit (`a3a9457`) dedicated expressly to
reconciling the document with the code. It was brought up to date and drifted
apart again over forty commits.

A hand-written list beside the code always ends like that. The only way it does
not is for it not to be by hand: it now comes out of `src/lib/oob.ts`, and the
registry is not decorative — the components ask it for their attributes, and the
type accepts no id that is not in it.

For an agent this matters more than for a person: `AGENTS.md` is the manual it
reads and trusts. When a part falls behind it is not untidy; it lies, and
somebody works on top of it.

---

## Why there is a round of tests with no database

Twelve files were already independent of the database without that being said
anywhere, and what is not said rots on its own. They are now in `tests/unit/`
and run in **900 milliseconds with no PostgreSQL**; in CI they are a separate
job **with no database service at all**, which is what keeps it honest.

The difference between 900 ms with nothing to set up and 50 s with a database in
front of you is the difference between checking and not checking.

Along the way this uncovered something: `bun test` against a freshly created
database gave **287 passes and 11 failures**, with four tests that did not even
start. The migrations are applied on importing `src/server.ts` and ten test
files import it, so they all started migrating at once. CI did not suffer it
because it runs `db:apply` first; the README did not say so. Who suffered it was
exactly whoever arrived new.

(The race also exists in production if two containers started at once. It wants
an advisory lock in `migrate.ts` and is still to be done.)

---

## Why `htmx-contract/` imports nothing

It is a piece that has to be liftable into a package of its own with a `git mv`.

The boundary that really stops that is the imports, and it is checked in full
(`bun run boundary`): no file under `htmx-contract/` may import from `src/`,
from `tests/`, or from any relative path escaping its own directory, and no
package outside its allowlist — which is `bun:test` and nothing else. Language
is no longer part of the check — the whole repository is English now, so there
is nothing left to tell apart.

**What it does not cover.** `swap.ts` is a **model** of HTMX 2, not HTMX. It
does not see the CSS, nor whether the layout's `htmx:*` hooks run, nor the
ECharts islands, nor any divergence between the model and the real algorithm.
The list is in the [`htmx-contract/` README](../htmx-contract/README.md), and it
is what has to be re-read whenever `public/htmx.min.js` is bumped.
