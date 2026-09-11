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

| Objectiu                      | De qui és            | Quan canvia                                    |
| ----------------------------- | -------------------- | ---------------------------------------------- |
| `#toast` _(contingut)_        | lib/http.ts          | qualsevol error o confirmacio                  |
| `#comptador-revisio`          | components/layout.ts | es classifica un moviment                      |
| `#comptador-avisos`           | components/layout.ts | es llegeix o es descarta un avis               |
| `#arbre-categories`           | routes/categories    | es crea, es canvia o s'esborra una categoria   |
| `#filtre-targetes`            | routes/transactions  | canvien les targetes conegudes de l'espai      |
| `#taula-recurrents-propostes` | routes/recurring     | es confirma o es descarta una proposta         |
| `#taula-recurrents-actives`   | routes/recurring     | es confirma, es canvia o es descarta una serie |
| `#llista-connexions`          | routes/connections   | es connecta, es mou o s'esborra un compte      |
| `#llista-usuaris`             | routes/users         | es crea, es canvia o s'esborra un usuari       |
| `#llista-feines`              | routes/jobs          | canvia la configuracio d'una feina             |
| `#historial-feines`           | routes/jobs          | acaba una execucio                             |
| `#en-curs`                    | routes/jobs          | arrenca o acaba una feina                      |
| `#agenda-salut`               | routes/jobs          | canvia l'estat del planificador                |

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
