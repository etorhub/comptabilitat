# AGENTS.md

Regles de la casa per a `comptabilitat`. On hi digui **sempre** o **mai**, és
sempre o mai. Si te'n vols apartar, canvia primer aquest fitxer.

Això són **les regles**. El perquè de cadascuna, amb les històries dels errors
que la van fer necessària, és a [`docs/perque.md`](docs/perque.md). Quan una
regla et sembli arbitrària, mira-hi abans de canviar-la: gairebé totes venen
d'una cosa que va passar de debò.

## La pila

Bun + Hono + **`hono/html`** + HTMX + Drizzle + PostgreSQL.

Sense JSX, sense empaquetador, sense encaminador de client, sense estat de
client, sense API de JSON per al navegador. El servidor dibuixa l'HTML; HTMX
enganxa el tros que ha canviat. Les plantilles són l'etiqueta `html`, que
retorna cadenes —i és això el que fa que un fragment es pugui provar sense
navegador ni DOM.

**Idioma:** català a `src/` i a `tests/`. Anglès a `htmx-contract/`, que algun
dia ha de marxar a un paquet seu. Si una peça extraïble sembla que necessita
alguna cosa de `src/`, està mal tallada: passa-li el que necessiti com a
argument.

## Les dues ordres

```bash
bun run ok        # després de qualsevol canvi. No cal base de dades: 1 segon
bun run test:bd   # abans d'empènyer, si has tocat rutes o base de dades
```

`bun run ok` és **obligatori abans d'empènyer**. Si falla, et diu quina passa ha
fallat i què has de fer. No empenyis esperant que el CI t'ho digui.

`bun test` a seques, sobre una base de dades acabada de crear, dona una dotzena
d'errors que no són teus: fes servir `test:bd`.

## Per començar un recurs

```bash
bun run nou-recurs <nom>          # dins d'un espai
bun run nou-recurs <nom> --admin  # administració de la instal·lació
```

Fa els quatre fitxers, els registra a `src/routes/index.ts` i els afegeix a la
taula de `tests/contracte.test.ts`. El que surt passa el `bun run ok` tal com
està.

Per veure'n un de fet del tot: **`src/routes/tags/`** (llista i detall) i
**`src/routes/categories/`** (mutacions amb intercanvi fora de banda). Copiar-ne
un és més segur que recordar-se de la convenció.

---

## Estructura

- **Tot recurs amb pàgina té els quatre fitxers** (`.routes`, `.page`,
  `.fragment`, `.schema`). Cap excepció. Si no necessita fragments, el fitxer hi
  és igualment i queda buit d'exportacions.
- **La lògica de negoci no és un recurs.** Va a `src/services/`, un mòdul per
  tema. Les rutes són primes: llegir paràmetres, autoritzar, cridar el servei,
  dibuixar.
- **`db/schema/` va per agregat, no per recurs.** Les claus foranes es creuen
  entre taules que la interfície tracta com a recursos diferents.

Quins recursos hi ha ara: [`docs/referencia.md`](docs/referencia.md).

## Pàgina o fragment

1. `GET <base>` retorna **sempre** una pàgina sencera.
2. `GET <base>/fragment/<nom>` retorna **sempre** un fragment.
3. `POST | PATCH | DELETE` retornen el **tros que ha canviat**, més els
   intercanvis fora de banda que calguin.

**Mai** miris la capçalera `HX-Request` per decidir **quin recurs** retornes. Una
adreça retorna una sola cosa; si no, l'historial, els enllaços compartits i les
proves es tornen ambigus.

**L'estat dels filtres i de la paginació viu a la cadena de consulta**, no en cap
variable de client. La ruta de fragment llegeix els mateixos paràmetres i
contesta amb `pushUrl()` apuntant a **l'adreça de la pàgina**.

Fes servir sempre els ajudants de `lib/http.ts` —`page()`, `fragment()`,
`redirect()`, `pushUrl()`, `withOob()`— i **mai** `c.html()` a pèl.

## Errors

- Un error contesta amb el codi que toqui (422, 403, 404, 409, 500) i un cos que
  conté **només** el `#toast` fora de banda.
- Fes servir `toastOnly()` de `lib/http.ts`, que hi posa `HX-Reswap: none`.
  **Sense aquesta capçalera l'intercanvi esborra l'element que l'usuari estava
  tocant** ([per què](docs/perque.md#e5dd962--un-error-senduia-la-fila-que-estaves-tocant)).
- **Cap ruta no s'inventa el seu propi lloc per als errors.**
- Llança `AppError`, `NotFoundError`, `ForbiddenError` o `ConflictError`; no
  retornis codis a mà.
- **Res que no esperessis no surt a la pantalla:** un error de la base de dades o
  del banc pot dur-hi dades personals.

## Validació

- Un esquema de Zod per recurs. Quan validi una fila, deriva'l de la taula de
  Drizzle amb `drizzle-zod`: **la taula és la font de veritat i el Zod en surt.**
- Quan `safeParse` falla: torna a dibuixar **el fragment del formulari** amb
  `errors` i codi **422**.
- **Els valors que ha escrit la persona es tornen sempre.** Un formulari que
  s'esborra quan falla la validació és una manera de fer enfadar la gent.

## Intercanvis fora de banda

- Quan una mutació canvia alguna cosa **fora del seu propi tros**, la torna al
  costat amb `withOob()`.
- L'objectiu ha de ser al registre de `src/lib/oob.ts`, i els atributs els posa
  `atributsOob()`. Un objectiu que no s'hi registri **no compila**.
- **Cada objectiu té un sol amo.** El fragment del recurs propietari l'exporta i
  cap altre el dibuixa.
- **Mai facis sondeig** ni tornis a demanar-ho tot després d'una mutació.

La llista: [`docs/referencia.md`](docs/referencia.md).

## Sondeig

L'excepció de la regla anterior: l'estat d'una sincronització i les feines en
curs a `/feines`.

- **Tot sondeig passa per `lib/sondeig.ts`.** Cap no s'escriu a mà: un
  `hx-trigger="every …"` sense límit declarat fa fallar la regla
  `unbounded-poll`.
- S'atura de dues maneres, i totes dues calen: quan la feina acaba, el fragment
  nou ja no duu disparador; i si no acaba **mai**, el compte d'intents
  s'exhaureix i la pàgina ho diu.
- El compte viatja **a l'adreça que se sondeja**, no en cap variable de client.

## Espais estancs

Dues garanties del producte, no detalls d'implementació:

1. **Qui no té accés a un espai rep un 404, mai un 403.** «No existeix» i «no hi
   tens accés» han de donar exactament la mateixa resposta, byte a byte.
2. **Ser administrador de la instal·lació no dona accés a cap espai.**

- Cap ruta de dades no consulta `ledgers` pel seu compte: totes pengen del
  `workspaceMiddleware`.
- **Tota consulta d'un objecte comprova que sigui de l'espai**, encara que
  l'identificador vingui de l'adreça.
- `requireEditor` / `requireWorkspaceAdmin` per als permisos de dins.

## Privadesa

- **`transactions.raw` i `accounts.raw` no es dibuixen mai.** Duen la resposta
  sencera del banc. Les consultes que alimenten una plantilla demanen **columnes
  explícites**; mai `select()` a seques.
- **L'emmascarament s'aplica a la consulta, no a la plantilla.** Passa-ho tot per
  `toTransactionView()`; el tipus de la fila crua no s'importa mai des de
  `routes/`.
- De l'IBAN, a una plantilla només hi arriba la versió emmascarada.
- La clau privada d'Enable Banking **no es registra mai** ni entra en cap cos
  d'error.

## CSRF

- El testimoni es publica **un sol cop**, com a `hx-headers` del `<body>`. Totes
  les peticions d'HTMX l'hereten.
- **Mai** posis un testimoni per formulari. L'única excepció és el formulari
  d'entrada, que encara no té sessió.
- L'única ruta exempta és `GET /api/auth/callback`, el retorn del banc.
- Si canvies la sessió enmig d'una petició, **invalides el testimoni que ja has
  dibuixat**. Per això canviar la contrasenya tanca _la resta_ de sessions.

## Diners

`numeric(14,2)` arriba de Drizzle com a **`string`**.

- A la vora de la base de dades, `string`; als serveis, `Decimal`; a la vora de
  la plantilla, `string` ja formatat. Fes servir `lib/money.ts`.
- **Mai `parseFloat` d'un import per fer-hi càlculs.** En comptabilitat això és
  un error de correcció, no una preferència d'estil.
- `number` només per als gràfics (`toChartNumber()`), i la conversió es fa al
  fragment que construeix el paquet del gràfic, no al servei.

## JavaScript de client

N'hi ha molt poc i ha de continuar sent així.

- **No introdueixis cap marc de client ni cap estat que depengui d'un
  empaquetador.** Si sembla que una cosa ho demana, atura't i pregunta.
- L'únic que hi ha: el `htmx:beforeSwap` dels 4xx, el redibuix dels gràfics i
  l'`onchange` del selector d'espais.
- **Els gràfics són illes**: ECharts des d'una etiqueta `<script>`, amb les dades
  en un `<script type="application/json">` que dibuixa el servidor.
- HTMX i ECharts se serveixen des de `public/`, no d'un CDN: això ha de funcionar
  en un NAS.

## Base de dades

- **L'esquema de `src/db/schema/` descriu la base de dades que ja hi ha.** Els
  noms de les restriccions són els d'Alembic; **no els canviïs**.
- Les enumeracions són `varchar(32)` sense CHECK: qui garanteix el valor és
  `db/schema/enums.ts` i el Zod.

## Proves

- **`tests/unitat/` no toca la base de dades.** Una prova nova que no en
  necessiti va aquí; si en necessita, es queda a `tests/`. A la integració
  contínua la primera tanda corre sense cap servei de PostgreSQL, i és això el
  que ho manté honest.
- **`tests/contracte.test.ts` demana cada pàgina** i la passa pel contracte
  d'HTMX. La seva taula ha de cobrir tot `src/routes/`, i hi ha una prova que ho
  comprova.
- **`tests/espais.test.ts` és la més important**: comprova les dues garanties
  dels espais estancs. **No la toquis per fer passar res.**
- Cap prova no toca res de fora: el banc, el correu i el model local són
  servidors locals que munta la prova mateixa.
- Si canvies `dedupKey()`, la propera importació duplicarà tot l'historial en
  silenci. Hi ha una prova que ho impedeix, i no és per treure-la.

## En acabar

1. `bun run ok` net.
2. `bun run test:bd` verd si has tocat rutes o base de dades.
3. Comprova que cada objectiu fora de banda que toca el recurs s'actualitza de
   debò, mutant des d'una pàgina que no el conté.
4. Només aleshores, el commit.
