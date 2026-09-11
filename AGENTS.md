# AGENTS.md

Regles de la casa per a `comptabilitat`, ara sobre **Bun + Hono + `hono/html` +
HTMX + Drizzle**.

Les plantilles son l'etiqueta `html` de `hono/html`, que retorna cadenes: **no
hi ha JSX enlloc**, i els fitxers son `.ts` com la resta. Hi va haver una
temporada en que aquest document deia `hono/jsx` i el `tsconfig.json` el tenia
configurat, pero cap fitxer no n'ha fet servir mai. Que les plantilles siguin
cadenes es el que fa que un fragment es pugui provar sense navegador ni DOM.

Estan escrites com a regles, no com a consells: on hi digui **sempre** o **mai**,
és sempre o mai. Si te'n vols apartar, canvia primer aquest fitxer i després tots
els recursos alhora. **Val més ser consistents que ser llestos en un lloc.**

---

## La idea

**El servidor és l'única font de veritat, tant de les dades com de l'estat de la
interfície.** No hi ha encaminador de client, ni magatzem d'estat, ni DOM
virtual, ni API de JSON perquè el navegador se la mengi.

Cada interacció és o bé una càrrega de pàgina sencera, o bé una petició d'HTMX
que torna un tros d'HTML que HTMX enganxa al seu lloc.

Idioma del codi: **català**, com fins ara. Identificadors, comentaris i text de
la interfície.

**L'excepció són els directoris que han de marxar.** `htmx-contract/` no és
d'aquesta aplicació: és una peça que s'ha de poder endur a un paquet seu amb un
`git mv`, i per això és **en anglès** i no importa res de `src/` ni de `tests/`.
Canviar-li els noms el dia que marxi voldria dir llençar l'historial que la
mudança existeix per conservar.

La frontera no és una bona intenció: `bun run frontera` (dins de `bun run
check`) comprova que aquests directoris no importin res de fora ni cap paquet
que no sigui a la seva llista blanca, i avisa dels identificadors que semblen
catalans. Els comentaris i els textos no es miren: un comentari que cita el
títol d'un commit és en català amb tota la raó, i el marcatge dels fixtures és
una còpia del que dibuixa l'aplicació.

Si una peça extraïble sembla que necessita alguna cosa de `src/`, està mal
tallada: passa-li el que necessiti com a argument.

---

## D'on ve això

Fins al setembre del 2026 això era una API de FastAPI amb una interfície de
React al davant. Molts fitxers de `src/` diuen d'on venen («traducció de
`backend/app/services/...`»): **aquells camins ja no existeixen**, són a
l'historial del git. Serveixen per saber què s'estava traduint i per què una
funció fa el que fa, no per anar-hi a mirar.

Quan una decisió d'abans no era bona, el comentari ho diu. No es dona per bo
res només perquè ho fos.

---

## Estructura

```
src/
  routes/<recurs>/
    <recurs>.routes.ts      registre de rutes i guardes
    <recurs>.page.ts        pàgina sencera (GET)
    <recurs>.fragment.ts    fragments d'HTMX i els seus intercanvis fora de banda
    <recurs>.schema.ts      Zod
  db/schema/                per agregat, no per recurs
  db/client.ts
  components/               disposició, formularis, avisos
  services/                 la lògica: importació, classificació, informes…
  lib/                      config, auth, csrf, http, money, html
  middleware/               sessió, csrf, espai
  workers/                  planificador
```

- **Tot recurs amb pàgina té els quatre fitxers.** Cap excepció. Si un no
  necessita fragments, el fitxer existeix igualment i queda buit
  d'exportacions. `exports/` (dos fitxers: descàrregues penjades de Moviments
  i d'Informes, sense pàgina pròpia) i `home/` (un fitxer: nomes redirigeix a
  l'espai actiu) no en són excepcions a la regla — son fora del seu abast, ja
  que cap dels dos té `GET <base>` retornant una pàgina.
- **La lògica de negoci no és un recurs.** `sync`, `normalization`,
  `classification`, `forecast`, `recurring`, `reports`... van a `src/services/`,
  un mòdul per tema. Les rutes són primes: llegir paràmetres, autoritzar,
  cridar el servei, dibuixar.
- **`db/schema/` va per agregat, no per recurs.** Les claus foranes es creuen
  entre taules que la interfície tracta com a recursos diferents.

Quins recursos hi ha ara mateix, i quins dels quatre fitxers té cadascun. Surt
de `src/routes/`; no s'edita a mà.

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

---

## Pàgina o fragment

Tres regles i cap excepció:

1. `GET <base>` retorna **sempre** una pàgina sencera.
2. `GET <base>/fragment/<nom>` retorna **sempre** un fragment.
3. `POST | PATCH | DELETE` retornen el **tros que ha canviat**, més els
   intercanvis fora de banda que calguin.

**Mai** es mira la capçalera `HX-Request` per decidir **quin recurs** es
retorna. Una adreça retorna una sola cosa; si no, l'historial, els enllaços
compartits, la memòria cau i les proves es tornen ambigus.

Es mira a tres llocs, i cap dels tres tria el recurs: `server.ts` (`notFound`,
`onError`) i `redirect()` a `lib/http.ts` decideixen **com ensenyar** un error
o una redirecció (un `#toast` fora de banda a una petició d'HTMX, una pàgina o
una capçalera `HX-Redirect` si no), no què hi ha a l'altra banda de l'adreça.

**L'estat dels filtres i de la paginació viu a la cadena de consulta de la
pàgina**, no en cap variable de client. La ruta de fragment llegeix els mateixos
paràmetres i contesta amb `HX-Push-Url` apuntant a **l'adreça de la pàgina**
(`pushUrl()` a `lib/http.ts`). Així els filtres es poden enllaçar i el botó
d'enrere funciona.

Fes servir sempre els ajudants de `lib/http.ts` — `page()`, `fragment()`,
`redirect()`, `pushUrl()`, `withOob()` — i mai `c.html()` a pèl.

---

## CSRF

L'aplicació de Python **no en tenia cap defensa**. Ara sí, i funciona així:

- El testimoni és `HMAC-SHA256(SECRET_KEY, resum_del_testimoni_de_sessió)`. No
  cal cap taula: va lligat a la sessió, gira amb ella i mor amb ella.
- Es publica **un sol cop**, com a `hx-headers` del `<body>` a
  `components/layout.ts`. Totes les peticions d'HTMX l'hereten.
- **Mai** posis un testimoni per formulari. L'única excepció de tota
  l'aplicació és el formulari d'entrada, que encara no té sessió i duu un camp
  ocult `_csrf` derivat d'una galeta llavor d'un sol ús.
- Tota petició que no sigui `GET`/`HEAD` passa pel middleware, que a més
  comprova `Sec-Fetch-Site`/`Origin`.
- **L'única ruta exempta** és `GET /api/auth/callback`, el retorn del banc: qui
  hi arriba ve de fora i el que la protegeix és l'`eb_auth_state` d'un sol ús.

Si canvies la sessió d'un usuari enmig d'una petició, recorda que **invalides el
testimoni que ja has dibuixat a la pàgina**. Per això canviar-se la contrasenya
tanca _la resta_ de sessions i conserva l'actual (`destroyOtherSessions()`).

---

## Errors: sempre a `#toast`

- Un error contesta amb el codi que toqui (422 validació, 403, 404, 409, 500) i
  un cos que conté **només** `<div id="toast" hx-swap-oob="true">…</div>`.
- Fes servir `toast()` i `toastError()` de `lib/http.ts`. **Cap ruta no
  s'inventa el seu propi lloc per als errors.**
- HTMX no intercanvia els 4xx per defecte. El `htmx:beforeSwap` de la
  disposició ho permet. Si algun dia treus aquell tros, els errors deixen
  d'arribar a la pantalla sense que res peti.
- **Res que no esperessis no surt a la pantalla.** `describeError()` registra
  l'error i contesta «hi ha hagut un error inesperat»: un error de la base de
  dades o del banc pot dur-hi dades personals.

Llança `AppError`, `NotFoundError`, `ForbiddenError` o `ConflictError`; no
retornis codis a mà.

---

## Validació

- Un esquema de Zod per recurs, a `<recurs>.schema.ts`. Quan validi una fila,
  deriva'l de la taula de Drizzle amb `drizzle-zod` i refina'l: **la taula és la
  font de veritat i el Zod en surt**, no al revés.
- Quan `safeParse` falla: torna a dibuixar **el fragment del formulari** amb
  `errors`, amb codi **422**.
- Els errors per camp es dibuixen amb els components de `components/form.ts`,
  que ja posen `aria-invalid` i `aria-describedby`.
- **Els valors que ha escrit la persona es tornen sempre.** Un formulari que
  s'esborra quan falla la validació és una manera de fer enfadar la gent.

---

## Intercanvis fora de banda

Quan una mutació canvia alguna cosa que és **fora del seu propi tros**, la torna
al costat, amb `hx-swap-oob="true"`. Fes servir `withOob()`.

**Aquesta taula surt de `src/lib/oob.ts`; no s'edita a mà.** Hi va haver una
temporada que en llistava tres mentre el codi en dibuixava tretze, i això
després d'un commit dedicat a reconciliar-la. Ara la genera `bun run docs` i
`bun run check` falla si no encaixa.

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

Els **rebuts previstos** (`recurring_series`) són schedules: el detector només
proposa (`suggested`); la persona confirma (`active`) o descarta a
`/recurrents`. La previsió de saldo només mira les `active` amb
`include_in_forecast`. No hi ha objectiu fora de banda de resum de
subscripcions: la llista i el panell de recurrents es tornen a dibuixar amb
la mutació de la pròpia pàgina.

- **Cada objectiu té un sol amo.** El fragment del recurs propietari l'exporta i
  cap altre recurs no el dibuixa.
- **Mai facis sondeig** ni tornis a demanar-ho tot. Això substitueix
  l'`invalidaEspai()` de l'aplicació de React, que després de cada mutació
  refrescava la llista, el panell i els dos comptadors sense dir-ho.
- **Excepció única:** l'estat d'una sincronització del banc i el monitoratge
  de feines en curs a `/feines`. **Tot sondeig passa per `lib/sondeig.ts`**, i
  cap no s'escriu a mà: un `hx-trigger="every …"` sense límit declarat fa
  fallar la regla `unbounded-poll`.

  S'aturen de dues maneres, i totes dues calen. Quan la feina acaba, el
  fragment nou ja no duu disparador. I si no acaba **mai** —un procés mort
  enmig deixa la fila en `running` per sempre— el compte d'intents s'exhaureix
  i la pàgina ho diu. Sense la segona, una importació interrompuda deixava la
  pàgina preguntant cada dos segons, indefinidament i per a tothom qui la
  mirés; el marcatge d'un sondeig que s'aturarà i el d'un que no s'aturarà mai
  eren idèntics.

  El compte viatja **a l'adreça que se sondeja**, no en cap variable de client:
  cada resposta demana l'intent següent. És la mateixa regla que la dels
  filtres.

- **`#toast` no fa `hx-swap-oob="true"` com la resta.** Fa
  `hx-swap-oob="innerHTML:#toast"`: es canvia el **contingut**, no el
  contenidor. El `<div id="toast">` neix amb `aria-live="polite"` a
  `components/layout.ts`; si es reemplacés el node sencer, el de recanvi
  hauria de dur el mateix atribut o deixaria de ser una regió viva a partir
  del primer avís.
- **El saldo de la capçalera del panell (`#saldo-capcalera`) no és cap
  objectiu fora de banda**, tot i que ho va ser en una versió anterior
  d'aquest document. Sincronitzar es fa des de `/connexions`, una pàgina
  d'administració sense cap espai concret; el saldo viu al panell d'un espai
  (`/e/:codi`). Són dues pàgines que mai coincideixen al DOM del navegador amb
  aquest tipus de navegació (sense cap web socket ni SSE), i no hi ha cap
  mutació al panell mateix que l'hagi de refrescar sense recarregar. Es veu al
  dia perquè es torna a calcular cada cop que el panell es carrega.

---

## Espais estancs

Dues garanties del producte, no detalls d'implementació:

1. **Qui no té accés a un espai rep un 404, mai un 403.** No ha de saber ni que
   existeix. «No existeix» i «no hi tens accés» han de donar exactament la
   mateixa resposta, byte a byte.
2. **Ser administrador de la instal·lació no dóna accés a cap espai.** L'accés
   es concedeix un per un.

- Cap ruta de dades no consulta `ledgers` pel seu compte: totes pengen del
  `workspaceMiddleware`.
- **Tota consulta d'un objecte comprova que sigui de l'espai**, encara que
  l'identificador vingui de l'adreça. Si no, es poden tocar les dades d'un altre
  espai endevinant números.
- `requireEditor` / `requireWorkspaceAdmin` per als permisos de dins.

> **Pendent de decidir.** A `alerts`, marcar com a llegit i descartar els pot fer
> un `viewer`, a diferència de la resta de mutacions, que demanen `editor`. Es
> conserva com era al Python (`routes/alerts.py:39,47`). Sembla un descuit, però
> endurir-ho és un canvi de comportament i s'ha de decidir a part.

---

## Privadesa

- **`transactions.raw` i `accounts.raw` no es dibuixen mai.** Duen la resposta
  sencera del banc: noms, IBAN, contraparts. Les consultes que alimenten una
  plantilla demanen **columnes explícites**; mai `select()` a seques.
- **L'emmascarament és una funció de privadesa i s'aplica a la consulta, no a la
  plantilla.** Quan un moviment té `display_description`, aquell text
  substitueix el concepte del banc i el comerç i la contrapart **no es mostren
  ni es poden cercar**. Passa-ho tot per `toTransactionView()`; el tipus de la
  fila crua no s'importa mai des de `routes/`.
- De l'IBAN, a una plantilla només hi arriba la versió emmascarada.
- La clau privada d'Enable Banking es llegeix un cop en arrencar i **no es
  registra mai ni entra en cap cos d'error**. `EnableBankingError.payload` s'ha
  de netejar abans que pugui arribar a `#toast`.
- La galeta de sessió: `httpOnly`, `Secure`, `SameSite=Lax`, i a la base de
  dades només el resum SHA-256.

---

## Diners

`numeric(14,2)` arriba de Drizzle com a **`string`**.

- A la vora de la base de dades, `string`; als serveis, `Decimal`; a la vora de
  la plantilla, `string` ja formatat. Fes servir `lib/money.ts`.
- **Mai `parseFloat` d'un import per fer-hi càlculs.** En una aplicació de
  comptabilitat això és un error de correcció, no una preferència d'estil.
- `number` només per als grafics, que són només per mirar (`toChartNumber()`).
  La conversió es fa **al fragment que construeix el paquet del grafic**
  (`Grafic*()` a `routes/analytics/analytics.fragment.ts`), no al servei: la
  mateixa fila sovint també alimenta una taula amb `formatMoney()`, que no
  accepta `number`. El client (`public/grafics.js`) ja no fa cap `Number()`;
  el que rep del `<script type="application/json">` ja son numeros.

---

## JavaScript de client

N'hi ha molt poc i ha de continuar sent així.

- **No introdueixis cap marc de client ni cap estat de client que depengui d'un
  empaquetador.** Si sembla que una cosa ho demana, atura't i pregunta.
- L'únic que hi ha: el `htmx:beforeSwap` dels 4xx, el `htmx:afterSwap` que torna
  a dibuixar els gràfics, i el `onchange` del selector d'espais.
- **Els gràfics són illes**: ECharts des d'una etiqueta `<script>` (sense
  empaquetador), amb les dades en un `<script type="application/json">` que
  dibuixa el servidor. Cap estat de client.
- **Per triar una categoria, un `<select>` amb `<optgroup>`.** El pla de
  categories són dos nivells i això és exactament el que un `<optgroup>` sap
  fer: teclat, cerca escrivint i accessibilitat, de franc. Substitueix les 372
  línies del `SelectorCategoria` de l'aplicació de React.
- HTMX i ECharts es serveixen des de `public/`, no des d'un CDN: això ha de
  funcionar en un NAS.

---

## Base de dades

- **L'esquema de `src/db/schema/` descriu la base de dades que ja hi ha.** Fins
  al canvi de pila les migracions les feia Alembic; el seu darrer cap és
  `b2c3d4e5f6a7`.
- Les enumeracions **no** són tipus natius: són `varchar(32)` **sense cap
  restricció CHECK**. Qui garanteix el valor és `db/schema/enums.ts` i el Zod
  corresponent.
- **Els noms de les restriccions són els d'Alembic** (`pk_*`, `fk_*`, `uq_*`),
  no els que Drizzle posaria sol. Estan escrits a mà amb `primaryKey({ name })`
  i `foreignKey({ name })`. No els canviïs.
- Hi ha claus foranes asimètriques a propòsit: esborrar una categoria
  **esborra** les regles que l'assignen (`CASCADE`) però només deixa els
  moviments sense categoria (`SET NULL`).
- Comprovació que això segueix sent cert: aplica `drizzle/0000_*.sql` a una base
  de dades buida i compara-la amb `pg_dump --schema-only` contra la de debò.
  Ha de sortir **idèntica**.

---

## Proves

```bash
bun run check          # typecheck + lint + format:check + frontera (el mateix que el CI)
bun run test:unitat    # sense base de dades, menys d'un segon
bun run test:bd        # la resta; cal un PostgreSQL accessible
```

`bun run check` és **obligatori abans d'empènyer**. El CI falla si Prettier,
oxlint, `tsc` o la frontera no estan nets; no empentis esperant que el CI ho
digui. Si el format falla, `bun run format` i torna a comprovar.

**Dues tandes, i la primera no vol res.** `tests/unitat/` i `htmx-contract/` no
toquen la base de dades; a la integració contínua corren en una feina **sense
cap servei de PostgreSQL**, i és això el que manté honesta la separació. Una
prova nova que no necessiti base de dades va a `tests/unitat/`; si en necessita,
es queda a `tests/`.

**Per a la tanda amb base de dades, `bun run test:bd`, no `bun test` a seques.**
Les migracions s'apliquen en importar `src/server.ts`, i deu fitxers de proves
l'importen: en una base de dades acabada de crear es posen a migrar tots alhora
i xoquen. Surten una dotzena d'errors que no tenen res a veure amb el teu canvi,
i quatre proves que ni tan sols arrenquen. `test:bd` fa el que fa el CI —migrar
primer, `SKIP_MIGRATIONS=true` després—, i llavors surt verd.

- `tests/contracte.test.ts` demana **cada pàgina** de l'aplicació i la passa pel
  contracte d'HTMX. La seva taula ha de cobrir tot `src/routes/`, i hi ha una
  prova que ho comprova: si afegeixes un recurs, afegeix-hi l'entrada.
- `tests/espais.test.ts` és la més important: comprova les dues garanties dels
  espais estancs. **No la toquis per fer passar res.**
- Cap prova no toca res de fora. El banc, el servidor de correu i el model
  local són servidors locals que munta la prova mateixa; la normalització i les
  claus de deduplicació es comproven contra la sortida gravada de la
  implementació anterior. Si canvies `dedupKey()`, la propera importació no
  reconeixerà cap moviment i duplicarà tot l'historial en silenci: hi ha una
  prova que ho impedeix, i no és per treure-la.

---

## En acabar un recurs

1. `bun run check` net (tipus, lint i format).
2. `bun test` verd.
3. Obre'l al navegador: pàgina sencera, cada interacció d'HTMX, una validació
   que falla a posta, i el botó d'enrere després de canviar un filtre.
4. `curl` a la ruta de fragment i a la de pàgina: **la mateixa adreça no pot
   tornar les dues coses**.
5. Comprova que cada objectiu fora de banda que toca el recurs s'actualitza de
   debò, mutant des d'una pàgina que no el conté.
6. **Només aleshores** crea el commit i empenta: el CI no ha de ser el primer
   lloc on fallin tipus, lint o format.
