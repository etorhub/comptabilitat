# AGENTS.md

House rules for `comptabilitat`. Where it says **always** or **never**, it is
always or never. If you want to depart from one, change this file first.

These are **the rules**. The why of each one, with the stories of the bugs that
made it necessary, is in [`docs/why.md`](docs/why.md). When a rule looks
arbitrary, look there before changing it: nearly all of them come from something
that really happened.

## The stack

Bun + Hono + **`hono/html`** + HTMX + Drizzle + PostgreSQL.

No JSX, no bundler, no client router, no client state, no JSON API for the
browser. The server draws the HTML; HTMX swaps in the piece that changed. The
templates are the `html` tag, which returns strings — and that is what makes a
fragment testable without a browser and without a DOM.

**Language:** the code is **English** — identifiers, comments, test names, this
file and `docs/why.md` and `docs/reference.md`. Everything that reaches a
screen stays **Catalan**: template text, toast messages, seeded category names,
the local model's prompt, the alert emails. So do the **URL segments**
(`/e/:codi/moviments`, `/etiquetes`, `/connexions`) and the **query-string and
form field names** (`cerca`, `pagina`, `compte`, `nova_etiqueta`, …): they are
the wire format, and renaming one breaks links and bookmarks that already
exist.

The same goes for what is **typed by hand on the machine**: the `make` targets
(`make usuari`) and the CLI flags (`--espai`, `--rol`, `--codi`, `--descripcio`).
They are Catalan on purpose, they are written down in `docs/operacio.md`, and
renaming them buys nothing. Everything else under `.github/` and `scripts/` is
code and is English.

`htmx-contract/` is English like the rest, and on top of that it imports
nothing from `src/`: it has to be liftable into a package of its own. If an
extractable piece looks like it needs something from `src/`, it is cut wrong:
pass it what it needs as an argument.

## The two commands

```bash
bun run ok        # after any change. No database needed: 1 second
bun run test:db   # before pushing, if you touched routes or the database
```

`bun run ok` is **required before pushing**. When it fails it tells you which
step failed and what to do. Do not push and wait for CI to tell you.

Plain `bun test`, against a freshly created database, gives a dozen failures
that are not yours: use `test:db`.

## To start a resource

```bash
bun run new-resource <name>          # inside a workspace
bun run new-resource <name> --admin  # installation administration
```

It writes the four files, registers them in `src/routes/index.ts` and adds them
to the table in `tests/contract.test.ts`. What comes out passes `bun run ok` as
it stands.

For a finished one: **`src/routes/tags/`** (list and detail) and
**`src/routes/categories/`** (mutations with an out-of-band swap). Copying one
is safer than remembering the convention.

---

## Structure

- **Every resource with a page has the four files** (`.routes`, `.page`,
  `.fragment`, `.schema`). No exceptions. If it needs no fragments, the file is
  there all the same and exports nothing.
- **Business logic is not a resource.** It goes in `src/services/`, one module
  per subject. The routes are thin: read parameters, authorize, call the
  service, draw.
- **`db/schema/` goes by aggregate, not by resource.** Foreign keys cross
  between tables that the interface treats as different resources.

Which resources exist right now: [`docs/reference.md`](docs/reference.md).

## Page or fragment

1. `GET <base>` **always** returns a whole page.
2. `GET <base>/fragment/<name>` **always** returns a fragment.
3. `POST | PATCH | DELETE` return the **piece that changed**, plus whatever
   out-of-band swaps are needed.

**Never** look at the `HX-Request` header to decide **which resource** you
return. A URL returns one thing; otherwise history, shared links and the tests
all turn ambiguous.

**Filter and pagination state lives in the query string**, not in any client
variable. The fragment route reads the same parameters and answers with
`pushUrl()` pointing at **the page's URL**.

Always use the helpers in `lib/http.ts` — `page()`, `fragment()`, `redirect()`,
`pushUrl()`, `withOob()` — and **never** a bare `c.html()`.

## Errors

- An error answers with the right status (422, 403, 404, 409, 500) and a body
  containing **only** the out-of-band `#toast`.
- Use `toastOnly()` from `lib/http.ts`, which sets `HX-Reswap: none`.
  **Without that header the swap deletes the element the user was touching**
  ([why](docs/why.md#e5dd962--an-error-took-away-the-row-you-were-touching)).
- **No route invents its own place for errors.**
- Throw `AppError`, `NotFoundError`, `ForbiddenError` or `ConflictError`; do not
  return status codes by hand.
- **Nothing unexpected reaches the screen:** an error from the database or from
  the bank can carry personal data.

## Validation

- One Zod schema per resource. When it validates a row, derive it from the
  Drizzle table with `drizzle-zod`: **the table is the source of truth and the
  Zod comes out of it.**
- The schema's **keys are the wire format** and stay Catalan: they are the
  query-string and form field names the browser sends.
- When `safeParse` fails: redraw **the form fragment** with `errors` and status
  **422**.
- **Whatever the person typed always comes back.** A form that empties itself
  when validation fails is a way of making people angry.

## Out-of-band swaps

- When a mutation changes something **outside its own piece**, it returns it
  alongside with `withOob()`.
- The target has to be in the registry of `src/lib/oob.ts`, and `oobAttributes()`
  writes its attributes. A target that is not registered there **does not
  compile**.
- **Each target has a single owner.** The owning resource's fragment exports it
  and no other draws it.
- **Never poll** and never re-request everything after a mutation.

The list: [`docs/reference.md`](docs/reference.md).

## Polling

The exception to the rule above: the state of a synchronization and the jobs in
progress at `/feines`.

- **Every poll goes through `lib/polling.ts`.** None is written by hand: an
  `hx-trigger="every …"` with no declared limit fails the `unbounded-poll` rule.
- It stops in two ways, and both are needed: when the job finishes the new
  fragment carries no trigger; and if it **never** finishes, the attempt counter
  runs out and the page says so.
- The counter travels **in the polled URL**, not in any client variable.

## Watertight workspaces

Two product guarantees, not implementation details:

1. **Whoever has no access to a workspace gets a 404, never a 403.** «It does
   not exist» and «you have no access» have to give exactly the same response,
   byte for byte.
2. **Being an installation administrator grants access to no workspace.**

- No data route queries `ledgers` on its own: they all hang off
  `workspaceMiddleware`.
- **Every query for an object checks that it belongs to the workspace**, even
  when the id comes from the URL.
- `requireEditor` / `requireWorkspaceAdmin` for the permissions inside.

## Privacy

- **`transactions.raw` and `accounts.raw` are never drawn.** They carry the
  bank's whole response. Queries feeding a template ask for **explicit
  columns**; never a bare `select()`.
- **Masking is applied in the query, not in the template.** Put everything
  through `transactionView()`; the raw row's type is never imported from
  `routes/`.
- Of the IBAN, only the masked version reaches a template.
- The Enable Banking private key **is never logged** and never enters an error
  body.

## CSRF

- The token is published **once**, as the `<body>`'s `hx-headers`. Every HTMX
  request inherits it.
- **Never** put a token per form. The only exception is the sign-in form, which
  has no session yet.
- The only exempt route is `GET /api/auth/callback`, the return from the bank.
- If you change the session mid-request, **you invalidate the token you already
  drew**. That is why changing the password closes _the other_ sessions.

## Money

`numeric(14,2)` arrives from Drizzle as a **`string`**.

- At the database edge, `string`; in the services, `Decimal`; at the template
  edge, an already-formatted `string`. Use `lib/money.ts`.
- **Never `parseFloat` an amount to calculate with it.** In accounting that is a
  correctness bug, not a style preference.
- `number` only for the charts (`toChartNumber()`), and the conversion happens in
  the fragment that builds the chart's payload, not in the service.

## Client JavaScript

There is very little and it has to stay that way.

- **Do not introduce any client framework or any state that depends on a
  bundler.** If something looks like it is asking for one, stop and ask.
- All there is: the `htmx:beforeSwap` for 4xx, the chart redraw and the
  workspace picker's `onchange`.
- **The charts are islands**: ECharts from a `<script>` tag, with the data in a
  `<script type="application/json">` the server draws.
- HTMX and ECharts are served from `public/`, not from a CDN: this has to work
  on a NAS.

## Database

- **The schema in `src/db/schema/` describes the database that already exists.**
  The constraint names are Alembic's; **do not change them**.
- The enumerations are `varchar(32)` with no CHECK: what guarantees the value is
  `db/schema/enums.ts` and the Zod.

## Tests

- **`tests/unit/` does not touch the database.** A new test that needs none goes
  here; if it needs one, it stays in `tests/`. In CI the first round runs with
  no PostgreSQL service at all, and that is what keeps this honest.
- **`tests/contract.test.ts` requests every page** and puts it through the HTMX
  contract. Its table has to cover all of `src/routes/`, and there is a test
  that checks it.
- **`tests/workspaces.test.ts` is the most important one**: it checks the two
  watertight-workspace guarantees. **Do not touch it to make anything pass.**
- No test touches anything outside: the bank, the mail and the local model are
  local servers the test itself starts.
- If you change `dedupKey()`, the next import will silently duplicate the whole
  history. There is a test that stops it, and it is not there to be removed.

## When you are done

1. `bun run ok` clean.
2. `bun run test:db` green if you touched routes or the database.
3. Check that every out-of-band target the resource touches really updates, by
   mutating from a page that does not contain it.
4. Only then, the commit.
