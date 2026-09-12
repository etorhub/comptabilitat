# Where this stands, and what comes next

Written at the end of the session that named the stack and extracted the
library, so the next session — or the next person — starts with the context
rather than the archaeology.

## Decisions already made

**The name is PLEYN**, Middle English for *plain*. Chosen after `cairn` and
`create-cairn` turned out to be taken on npm, and after discovering that every
common English word is gone from that namespace — `spare`, `stark`, `quiet`,
`slab`, `folio`, `wedge`, `terse`, `bare`, `legible`, all of them. That is why
Vite, Astro, Hono, Zod, Bun, Qwik and Svelte are coined, foreign or deliberately
misspelled: it is the only space left. `pleyn`, `create-pleyn` and `pleyn-stack`
were all verified free.

**The library keeps its descriptive name**, `htmx-contract`, not
`@pleyn/contract`. It is the thing that will bring people to the stack rather
than the other way round: somebody searching npm for htmx tooling will find
`htmx-contract` and has no reason ever to search for "pleyn". It also works with
any htmx backend, so hiding it inside an unknown brand costs it its natural
audience.

**The library was split with history, not copied.** `git subtree split` carried
the five commits that explain why each rule exists. The boundary check in the
origin repository existed precisely to keep that possible.

## Immediate next steps

1. **Publish `htmx-contract` to npm.** The package is ready: `package.json` with
   `exports` and `files`, MIT, CI green, 50 tests passing standalone. Publish
   from GitHub Actions with `--provenance` for a verifiable link between package
   and build. The name is free as of this writing.

2. **A public reference application.** The largest item, and the one that
   unblocks everything else. It cannot be the origin application — that is real
   personal finances with live bank integration, family workspace names, and a
   non-English UI throughout. This needs to be small, obviously fake, and built
   to demonstrate the conventions: the four-file resource rule, page vs
   fragment, the out-of-band registry, the two test tiers, generated docs.

3. **A template repository** — the reference app with the domain removed, marked
   as a GitHub template so people get a "Use this template" button. Cheap once
   step 2 exists.

4. **`create-pleyn`** — a scaffolding CLI. Most work, least urgent; skip it
   until people ask. The origin repository's `scripts/new-resource.ts` is the
   hard part already solved: it writes the four files, registers the resource
   and adds it to the conformance table, and what it emits passes the full check
   as it stands.

## The conventions to carry over

These are the rules the origin application runs on. They belong in this
repository's own `AGENTS.md` once the reference app exists.

- **Four files per resource with a page**: `.routes`, `.page`, `.fragment`,
  `.schema`. No exceptions; an unused file stays and exports nothing.
- **`GET <base>` always returns a whole page. `GET <base>/fragment/<name>`
  always returns a fragment.** Never branch on the `HX-Request` header to decide
  *which resource* you return — a URL returns one thing, or history and shared
  links turn ambiguous.
- **Filter and pagination state lives in the query string**, never a client
  variable. Fragment routes push the *page's* URL.
- **Errors return the right status and a body containing only the out-of-band
  toast, with `HX-Reswap: none`.** Without that header the swap deletes the
  element the user was touching. This is bug one.
- **Out-of-band targets live in a registry the components import.** An
  unregistered target does not compile. Each target has exactly one owner.
- **Every poll is bounded**, with the attempt counter in the polled URL.
- **One Zod schema per resource, derived from the table**, not hand-written. The
  schema keys are the wire format.
- **Business logic is not a resource.** Routes read parameters, authorize, call
  a service, and draw.

## Things worth knowing that cost time to learn

**`db.execute<T>()` generics are an assertion, not a check.** A Drizzle raw-SQL
generic that drifts from the SQL's own column alias compiles cleanly and returns
`undefined` at runtime. This shipped during the language migration and nothing
caught it — not `tsc`, not the tests, because the affected branch only runs
against a database with no tables. If the stack ever ships a lint rule, this is
the one worth writing.

**Renaming can silently collapse two bindings into one.** A rename that produces
a name already bound in an enclosing scope compiles, shadows, and changes
behaviour. The only reason it was caught was the linter's `no-shadow`.

**Word-list greps do not find everything.** Searching for known foreign words
finds only the words you thought of; it reported three remaining identifiers
when there were 246. Enumerating every declared name through the TypeScript AST
and reading the whole vocabulary is the check that actually terminates.

## Repository layout

- `etorhub/pleyn` — this repository. Doctrine, and eventually the docs site.
- `etorhub/htmx-contract` — the library. Independent of the stack.
- A reference application repository, once it exists.
