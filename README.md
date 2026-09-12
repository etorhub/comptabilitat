# Comptabilitat

Self-hosted personal and family accounting. It imports the transactions of your
bank accounts through the [Enable Banking](https://enablebanking.com) API,
classifies them (with the help of a local model via Ollama), and shows balances,
charts, recurring transactions, overdraft forecasts and exportable reports.

Three **watertight workspaces** live in it — **Personal**, **Calella** and
**Pardals**. Each is a completely separate set of books: its own accounts, its
own category plan, its own merchants, its own rules and its own users. **No view
mixes more than one**: you always work from inside a workspace.

So only you get into Personal; into Pardals, you and your partner; into Calella,
you and your mother-in-law. Whoever has no access to a workspace sees nothing of
it, not even that it exists.

## Structure

| Directory        | Contents                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`    | One folder per resource: routes, page, fragments and schemas                                                          |
| `src/services/`  | The logic: import, classification, recurring series, forecast, reports                                                |
| `src/db/schema/` | The Drizzle schema, by aggregate                                                                                      |
| `src/workers/`   | The scheduler and the five scheduled jobs                                                                             |
| `htmx-contract/` | The HTMX seam checker, with no imports from `src/`                                                                    |
| `public/`        | HTMX, ECharts, the compiled stylesheet and the charts file                                                            |
| `deploy/`        | Docker Compose stacks (production and local), Cloudflare tunnel and backups                                           |
| `docs/`          | The why (`why.md`), the generated reference (`reference.md`), workspaces, trying it locally, deployment and operation |

**One thing to run.** The server generates the HTML and serves its own static
files; there is no bundler, no JSON API for the browser and no client state. The
interactivity is HTMX: the server returns the piece of the page that changed. The
only lines of JavaScript of our own are the ECharts charts, which read their data
from a `<script type="application/json">` the server wrote. The house rules are in
[`AGENTS.md`](AGENTS.md), and the why of each one — with the stories of the bugs
that made it necessary — in [`docs/why.md`](docs/why.md).

## How it works

**Import.** Once a day, the `worker` asks the bank for the transactions since the
last known date minus a week of margin. Entries are deduplicated by the reference
the bank gives or, when there is none, by a stable digest of the data that does
not change. Pending transactions are reconciled with their booked entry instead of
being duplicated, and they keep whatever category you had set.

**Merchants.** A merchant (payee) is a transaction's counterparty: where the money
is spent or who is on the other side. It serves the category memory when
importing; it is not an interface resource. The same name is a different merchant
in each workspace.

**Classification.** Within each workspace the order is always the same, from the
cheapest and most explicit to the most expensive: what you decided (which is never
touched), the rules by priority, the merchant memory and, only for the merchants
that fitted nowhere, the local model. The rest goes to the review tray. When you
correct a category, the decision is remembered for every transaction of that
merchant **in that workspace**: your mother-in-law classifying in Calella touches
nothing in your Personal.

**The local model classifies by merchant, not by transaction.** That is what makes
a NAS with no graphics card viable: in normal running, few new merchants appear
each night, and once resolved they are never asked about again.

**Forecast.** The detector looks at the categorized history and **only proposes**
series (`suggested`). The person confirms them (`active`) or dismisses them under
**Recurrents**. The balance forecast only looks at the active series with
`include_in_forecast`; there is no residual variable-expense drift.

**Transfers.** Within one workspace, moving money between two of its accounts is
neither income nor expense: opposite amounts within three days are paired and stay
out of the reports. What arrives **from another workspace**, on the other hand,
does count: to whoever looks at Calella, money coming in is a real credit.

## Trying it right now

With Docker, without bank credentials or a tunnel:

```bash
make up      # start everything
make demo    # 18 months of sample transactions
```

Open **http://localhost:8080** and sign in with `demo@exemple.cat` /
`comptabilitat`. The details, and how to do it without Docker, are in
[`docs/provar-en-local.md`](docs/provar-en-local.md) (in Catalan, like the rest of
the operational guides).

## Setting it up for real

- **How the workspaces work**: [`docs/espais.md`](docs/espais.md)
- **On the NAS**: [`docs/desplegament.md`](docs/desplegament.md)
- **Enable Banking**: [`docs/enable-banking.md`](docs/enable-banking.md)
- **Day to day**: [`docs/operacio.md`](docs/operacio.md)

## Tests

After any change, one command:

```bash
bun run ok    # the checks + the round that wants no database. One second
```

When it fails it says which step failed and what to do.

`bun run test:unit` is `htmx-contract/` and `tests/unit/`: the markup, the
normalization, the exports and the HTMX contract. They do not touch the database,
and in CI they run as a job **with no PostgreSQL service at all**, which is what
keeps the separation honest.

The rest of the tests do want one, separately:

```bash
createdb comptabilitat_test
export DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
bun run test:db
```

**Use `bun run test:db`, not a bare `bun test`.** The migrations are applied on
importing `src/server.ts`, and ten test files import it: against a freshly created
database they all start migrating at once and collide. The result is a first pass
with a dozen failures that have nothing to do with your change. `test:db` does what
CI does — apply the migrations first and then `SKIP_MIGRATIONS=true` — and then it
comes out green. With the database already migrated, `bun test` works too.

No test touches anything outside: the bank, the mail server and the local model
are local servers the test itself starts.

The ones worth the most are those pinning behavior that would be expensive to
rediscover: the normalization of the concepts and the deduplication keys are
checked against the recorded output of the previous implementation, and
`tests/workspaces.test.ts` checks that whoever has no access to a workspace gets
exactly the same response as if it did not exist.

## Language

The code is **English** — identifiers, comments, test names, `AGENTS.md`,
`docs/why.md` and `docs/reference.md`. Everything that reaches a screen is
**Catalan**, and so are the URL segments (`/e/:codi/moviments`, `/etiquetes`) and
the query-string and form field names: they are the wire format, and renaming one
breaks links that already exist. The operational guides in `docs/` are Catalan
too — they are for whoever runs the NAS, not for whoever changes the code. The
rule is stated in full at the top of [`AGENTS.md`](AGENTS.md).
