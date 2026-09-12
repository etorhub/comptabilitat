# Referència

Taules generades del codi. **No s'editen a mà**: surten de `src/lib/oob.ts` i de
`src/routes/`, les escriu `bun run docs` i `bun run check` falla si no encaixen.

Són aquí i no a l'`AGENTS.md` perquè són material de consulta, i l'`AGENTS.md` ha
de cabre a la finestra de qui hi treballa.

## Objectius dels intercanvis fora de banda

Cada objectiu té **un sol amo**: el fragment del recurs propietari l'exporta i
cap altre el dibuixa. Per emetre'n un, `atributsOob()` de `src/lib/oob.ts`; el
tipus no accepta cap identificador que no sigui al registre, de manera que un
objectiu nou que no s'hi registri no compila.

<!-- generat:oob -->

| Objectiu                      | De qui és            | Quan canvia                                 |
| ----------------------------- | -------------------- | ------------------------------------------- |
| `#toast` _(contingut)_        | lib/http.ts          | any error or confirmation                   |
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

<!-- /generat:oob -->

## Recursos

La regla dels quatre fitxers, tal com està ara mateix. Les dues excepcions
(`exports/` i `home/`) no tenen `GET <base>` que retorni una pàgina, i per això
són fora del seu abast.

<!-- generat:recursos -->

| Recurs          | `.routes` | `.page` | `.fragment` | `.schema` |
| --------------- | --------- | ------- | ----------- | --------- |
| `alerts/`       | sí        | sí      | sí          | sí        |
| `analytics/`    | sí        | sí      | sí          | sí        |
| `auth/`         | sí        | sí      | sí          | sí        |
| `categories/`   | sí        | sí      | sí          | sí        |
| `connections/`  | sí        | sí      | sí          | sí        |
| `exports/`      | sí        | —       | —           | sí        |
| `home/`         | sí        | —       | —           | —         |
| `jobs/`         | sí        | sí      | sí          | sí        |
| `recurring/`    | sí        | sí      | sí          | sí        |
| `tags/`         | sí        | sí      | sí          | sí        |
| `transactions/` | sí        | sí      | sí          | sí        |
| `users/`        | sí        | sí      | sí          | sí        |
| `workspaces/`   | sí        | sí      | sí          | sí        |

<!-- /generat:recursos -->
