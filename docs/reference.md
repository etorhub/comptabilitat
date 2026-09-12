# Reference

Tables generated from the code. **They are not edited by hand**: they come from
`src/lib/oob.ts` and `src/routes/`, `bun run docs` writes them and
`bun run check` fails when they no longer match.

They are here and not in `AGENTS.md` because they are reference material, and
`AGENTS.md` has to fit in the window of whoever is working.

## Out-of-band swap targets

Each target has **a single owner**: the fragment of the owning resource exports
it and no other draws it. To emit one, `oobAttributes()` from `src/lib/oob.ts`;
the type accepts no id that is not in the registry, so a new target that is not
registered there does not compile.

<!-- generated:oob -->

| Target                        | Owner                | When it changes                             |
| ----------------------------- | -------------------- | ------------------------------------------- |
| `#toast` _(content)_          | lib/http.ts          | any error or confirmation                   |
| `#comptador-revisio`          | components/layout.ts | a transaction is categorised                |
| `#comptador-avisos`           | components/layout.ts | an alert is read or dismissed               |
| `#arbre-categories`           | routes/categories    | a category is created, changed or deleted   |
| `#filtre-targetes`            | routes/transactions  | the workspace's known cards change          |
| `#taula-recurrents-propostes` | routes/recurring     | a proposal is confirmed or dismissed        |
| `#taula-recurrents-actives`   | routes/recurring     | a series is confirmed, changed or dismissed |
| `#llista-connexions`          | routes/connections   | an account is connected, moved or deleted   |
| `#llista-usuaris`             | routes/users         | a user is created, changed or deleted       |
| `#llista-feines`              | routes/jobs          | a job's configuration changes               |
| `#historial-feines`           | routes/jobs          | a run finishes                              |
| `#en-curs`                    | routes/jobs          | a job starts or finishes                    |
| `#agenda-salut`               | routes/jobs          | the scheduler's state changes               |

<!-- /generated:oob -->

## Resources

The four-file rule, as it stands right now. The two exceptions (`exports/` and
`home/`) have no `GET <base>` returning a page, which is why they are outside
its scope.

<!-- generated:resources -->

| Resource        | `.routes` | `.page` | `.fragment` | `.schema` |
| --------------- | --------- | ------- | ----------- | --------- |
| `alerts/`       | yes       | yes     | yes         | yes       |
| `analytics/`    | yes       | yes     | yes         | yes       |
| `auth/`         | yes       | yes     | yes         | yes       |
| `categories/`   | yes       | yes     | yes         | yes       |
| `connections/`  | yes       | yes     | yes         | yes       |
| `exports/`      | yes       | —       | —           | yes       |
| `home/`         | yes       | —       | —           | —         |
| `jobs/`         | yes       | yes     | yes         | yes       |
| `recurring/`    | yes       | yes     | yes         | yes       |
| `tags/`         | yes       | yes     | yes         | yes       |
| `transactions/` | yes       | yes     | yes         | yes       |
| `users/`        | yes       | yes     | yes         | yes       |
| `workspaces/`   | yes       | yes     | yes         | yes       |

<!-- /generated:resources -->
