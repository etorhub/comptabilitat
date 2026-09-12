# El perquè de les regles

L'[`AGENTS.md`](../AGENTS.md) diu **què** s'ha de fer. Això diu **per què**, i
sobretot què va passar quan no es feia.

Són dos fitxers a propòsit. Les regles s'han de poder llegir senceres abans de
tocar res; els motius només calen quan una regla sembla arbitrària o quan et
planteges canviar-la. Barrejats, el fitxer es fa massa llarg per llegir-lo, i
llavors no es llegeix cap de les dues coses.

---

## D'on ve això

Fins al setembre del 2026 era una API de FastAPI amb una interfície de React al
davant. Molts fitxers de `src/` diuen d'on venen («traducció de
`backend/app/services/...`»): **aquells camins ja no existeixen**, són a
l'historial del git. Serveixen per saber què s'estava traduint i per què una
funció fa el que fa, no per anar-hi a mirar.

Quan una decisió d'abans no era bona, el comentari ho diu. No es dona per bo res
només perquè ho fos: l'aplicació de Python, per exemple, no tenia **cap** defensa
de CSRF.

---

## Els quatre errors de la costura d'HTMX

Aquests quatre expliquen la meitat de les regles, i tots quatre els va trobar una
persona amb un navegador obert, comptant files. Cap no el va veure ni el `tsc`,
ni l'oxlint, ni una prova de ruta.

Ara els veu `htmx-contract/`, que té el marcatge de cadascun guardat a
`fixtures.ts` i una regla que hi salta. Una regla que no falla contra el seu
propi error és decoració.

### `e5dd962` — un error s'enduia la fila que estaves tocant

Un 422 responia amb un cos que només duia el `#toast` fora de banda. HTMX treu
els nodes amb `hx-swap-oob` del fragment i els porta al seu lloc; el fragment es
queda **buit**, i llavors fa l'intercanvi principal amb aquest buit dins de
l'`hx-target`. Com que a tot arreu es fa servir `hx-swap="outerHTML"`, l'element
desapareixia.

Comprovat al navegador: forçant un 422 a una fila, la taula passava de 50 files
a 49. Sortia l'avís, això sí. Passava a tretze llocs, i els dos pitjors eren els
generals: el `notFound` i l'`onError` del servidor, i les tres respostes del
middleware de CSRF, que salten a **qualsevol** mutació amb la sessió caducada.

La cura és `HX-Reswap: none`, que fa que no hi hagi intercanvi principal i deixa
passar els fora de banda igualment. És el que fa `toastOnly()`.

### `f5b8e9b` — la taula desava la categoria a la fila que no tocava

El `<form>` de la selecció en bloc embolcallava la taula sencera, i cada fila hi
duia a dins la seva tria de categoria amb el mateix `name="category_id"`.

HTMX, per a qualsevol petició que no sigui GET, recull els valors del formulari
que envolta l'element (`getInputValues`) i els fa manar per sobre del valor de
l'element mateix (`overrideFormData`). El `parseBody` de Hono es queda l'última
ocurrència. Triar «Habitatge» a la primera fila hi desava la categoria de
l'última —i hi quedava com a `category_source = "user"`, que és l'únic estat que
la classificació no corregeix mai.

La cura és `hx-include`, que diu exactament què s'envia. I `Camp`/`Tria` accepten
un `id` propi: fins llavors totes les files dibuixaven `id="category_id"`, que és
HTML invàlid i fa que l'`aria-describedby` apunti sempre a la primera.

**Les caselles i els botons d'opció són l'excepció.** Compartir nom és el que
són: cinc `<input type="checkbox" name="tipus">` són un filtre multivalor, no una
col·lisió. La regla ho va aprendre tard, saltant a tots els filtres honestos de
l'aplicació.

### `da64cb1` — esborrar l'última fila deixava una capçalera sobre el no-res

Les files i l'avís de llista buida s'escrivien en branques separades, i res no
obligava les rutes d'esborrar a respectar la segona. Tornaven **només la fila**,
de manera que treure l'última regla deixava una capçalera de taula sobre un cos
buit, per sempre, sense dir enlloc que la llista s'havia acabat.

Per això `TaulaDades` demana `files` i `buit` alhora: **no hi ha manera de
dibuixar les unes sense dir també l'altre.**

### `f80df91` — una importació interrompuda sondejava per sempre

El fragment es tornava a armar mentre l'estat no fos terminal. Un
`docker compose stop` enmig matava el procés i la fila de `sync_runs` es quedava
en `running` per sempre: no hi ha ningú que la pugui acabar. La pàgina es quedava
demanant-la **cada dos segons, indefinidament, per a tothom qui la mirés**.

El marcatge d'un sondeig que s'aturarà i el d'un que no s'aturarà mai eren
idèntics, i per això no es veia venir. Ara el límit és **declarat**
(`data-poll-max`) i el compte d'intents viatja a l'adreça que se sondeja.

---

## Decisions que semblen arbitràries i no ho són

### El `#toast` canvia el contingut, no el contenidor

Fa `hx-swap-oob="innerHTML:#toast"` i no `="true"` com la resta. Una regió viva
l'ha d'anunciar el navegador quan hi entra text, i per això ha d'existir
**abans**: si se substitueix el node sencer, el que arriba és un node nou que
encara no era cap regió viva quan es va omplir. A més, el `#toast` de recanvi no
duia `aria-live`, de manera que a partir del primer avís la regió ja no hi era
per a ningú.

### El saldo de la capçalera no és cap objectiu fora de banda

Ho va ser en una versió anterior d'aquest document. Sincronitzar es fa des de
`/connexions`, una pàgina d'administració sense cap espai concret; el saldo viu
al panell d'un espai (`/e/:codi`). Són dues pàgines que **mai coincideixen al
DOM** amb aquest tipus de navegació —sense cap web socket ni SSE— i no hi ha cap
mutació al panell mateix que l'hagi de refrescar sense recarregar.

Si algun dia hi ha SSE, això s'ha de repensar.

### Les claus foranes són asimètriques

Esborrar una categoria **esborra** les regles que l'assignen (`CASCADE`) però
només deixa els moviments sense categoria (`SET NULL`). Una regla sense categoria
no vol dir res; un moviment sense categoria, sí.

### Les enumeracions no són tipus natius

Són `varchar(32)` **sense cap restricció CHECK**. Qui garanteix el valor és
`db/schema/enums.ts` i el Zod corresponent. Els noms de les restriccions són els
d'Alembic (`pk_*`, `fk_*`, `uq_*`), escrits a mà: l'esquema de `src/db/schema/`
**descriu la base de dades que ja hi ha**, i el seu últim cap d'Alembic és
`b2c3d4e5f6a7`.

### Un `<select>` amb `<optgroup>` per triar categoria

El pla de categories són dos nivells i això és exactament el que un `<optgroup>`
sap fer: teclat, cerca escrivint i accessibilitat, de franc. Substitueix les 372
línies del `SelectorCategoria` de l'aplicació de React.

### `alerts` deixa marcar com a llegit a un `viewer`

A diferència de la resta de mutacions, que demanen `editor`. Es conserva com era
al Python (`routes/alerts.py:39,47`). Sembla un descuit, però endurir-ho és un
canvi de comportament i s'ha de decidir a part. **Pendent de decidir.**

---

## Per què la documentació es genera

La taula dels objectius fora de banda en llistava **tres** quan el codi ja en
dibuixava **tretze** —i això després d'un commit (`a3a9457`) dedicat expressament
a reconciliar el document amb el codi. Es va posar al dia i se'n va tornar a
separar en quaranta commits.

Una llista escrita a mà al costat del codi sempre acaba així. L'única manera que
no passi és que no sigui a mà: ara surt de `src/lib/oob.ts`, i el registre no és
decoratiu —els components li demanen els atributs, i el tipus no accepta cap
identificador que no hi sigui.

Per a un agent, això importa més que per a una persona: l'`AGENTS.md` és el
manual que llegeix i del qual es fia. Quan una part queda enrere no és que
estigui desendreçada; és que menteix, i algú hi treballa a sobre.

---

## Per què hi ha una tanda de proves sense base de dades

Dotze fitxers ja eren independents de la base de dades sense que ho digués
enlloc, i el que no es diu es fa malbé sol. Ara són a `tests/unit/` i corren en
**900 mil·lisegons sense PostgreSQL**; a la integració contínua són una feina a
part **sense cap servei de base de dades**, que és el que ho manté honest.

La diferència entre 900 ms sense muntar res i 50 s amb una base de dades al
davant és la diferència entre comprovar-ho i no comprovar-ho.

De passada, això va destapar una cosa: `bun test` sobre una base de dades
acabada de crear donava **287 correctes i 11 errors**, amb quatre proves que ni
arrencaven. Les migracions s'apliquen en importar `src/server.ts` i deu fitxers
de proves l'importen, de manera que es posaven a migrar tots alhora. El CI no ho
patia perquè fa `db:apply` primer; el README no ho deia. Qui ho patia era
exactament qui arribava nou.

(La cursa també existeix en producció si arrenquessin dos contenidors alhora.
Demana un pany d'assessorament a `migrate.ts` i encara està per fer.)

---

## Per què `htmx-contract/` és en anglès i no importa res

És una peça que s'ha de poder endur a un paquet seu amb un `git mv`. Canviar-li
els noms el dia que marxi voldria dir llençar l'historial que la mudança
existeix per conservar.

La frontera que de debò ho impedeix no és l'idioma sinó les importacions, i
aquesta es comprova del tot (`bun run boundary`). L'idioma és una heurística
declarada: busca noms com `comprovaResposta`, que és el que surt per inèrcia. No
mira ni comentaris ni textos, perquè un comentari que cita el títol d'un commit
és en català amb tota la raó.

**El que no cobreix.** `swap.ts` és un **model** d'HTMX 2, no HTMX. No veu el
CSS, ni si els `htmx:*` de la disposició s'executen, ni les illes d'ECharts, ni
cap divergència entre el model i l'algorisme de debò. La llista és al
[README de `htmx-contract/`](../htmx-contract/README.md), i és el que s'ha de
tornar a llegir quan es pugi `public/htmx.min.js`.
