# Comptabilitat

Gestor de comptabilitat personal i familiar autoallotjat. Importa els moviments dels
comptes bancaris a través de l'API d'[Enable Banking](https://enablebanking.com), els
classifica (amb ajuda d'un model local via Ollama), i mostra saldos, gràfiques, moviments
recurrents, previsions de descobert i informes exportables.

Hi conviuen tres **espais de treball estancs** — **Personal**, **Calella** i **Pardals**.
Cadascun és una comptabilitat completament separada: els seus comptes, el seu pla de
categories, els seus comerços, les seves regles i els seus usuaris. **No hi ha cap vista
que en barregi més d'un**: sempre s'hi treballa des de dins d'un espai.

Així, a Personal només hi entres tu; a Pardals, tu i la parella; a Calella, tu i la sogra.
Qui no té accés a un espai no en veu res, ni tan sols que existeixi.

## Estructura

| Directori        | Contingut                                                                  |
| ---------------- | -------------------------------------------------------------------------- |
| `src/routes/`    | Una carpeta per recurs: rutes, pàgina, fragments i esquemes                |
| `src/services/`  | La lògica: importació, classificació, recurrents, previsió, informes       |
| `src/db/schema/` | L'esquema de Drizzle, per agregats                                         |
| `src/workers/`   | El planificador i les cinc feines programades                              |
| `public/`        | HTMX, ECharts, el full d'estil compilat i el fitxer de les gràfiques       |
| `deploy/`        | Stacks de Docker Compose (producció i local), túnel de Cloudflare i còpies |
| `docs/`          | Regles i motius, espais, provar-ho en local, desplegament i operació       |

**Una sola cosa que córrer.** El servidor genera l'HTML i serveix els seus
estàtics; no hi ha ni empaquetador, ni API JSON per al navegador, ni estat de
client. La interactivitat és HTMX: el servidor torna el tros de pàgina que ha
canviat. Les úniques línies de JavaScript pròpies són les gràfiques d'ECharts,
que llegeixen les dades d'un `<script type="application/json">` que ha escrit
el servidor. Les regles de la casa són a [`AGENTS.md`](AGENTS.md), i el perquè de cadascuna
—amb les històries dels errors que la van fer necessària— a
[`docs/perque.md`](docs/perque.md).

## Com funciona

**Importació.** Un cop al dia, el `worker` demana al banc els moviments des de l'última
data coneguda menys una setmana de marge. Els apunts es dedupliquen per la referència que
dona el banc o, si no n'hi ha, per un resum estable de les dades que no canvien. Els
moviments pendents es reconcilien amb el seu apunt definitiu en comptes de duplicar-se, i
conserven la categoria que hi haguessis posat.

**Comerços.** Un comerç (payee) és la contrapart d'un moviment: on es gasta o
qui hi ha a l'altra banda. Serveix per a la memòria de categoria en importar;
no és un recurs de la interfície. El mateix nom és un comerç diferent a cada
espai.

**Classificació.** Dins de cada espai, l'ordre és sempre el mateix, del més barat i explícit
al més car: el que has decidit tu (que no es toca mai), les regles per prioritat, la memòria
de comerços i, només per als comerços que no han encaixat enlloc, el model local. La resta
va a la safata de revisió. Quan corregeixes una categoria, la decisió es recorda per a tot
el comerç **d'aquell espai**: la sogra classificant a Calella no toca res del teu Personal.

**El model local classifica per comerç, no per moviment.** És el que fa viable un NAS sense
targeta gràfica: en règim normal apareixen pocs comerços nous cada nit, i un cop resolts no
es tornen a preguntar mai més.

**Previsió.** El detector mira l'històric categoritzat i **només proposa** sèries
(`suggested`). La persona les confirma (`active`) o les descarta a **Recurrents**.
La previsió de saldo només mira les sèries actives amb `include_in_forecast`;
no hi ha deriva de despesa variable residual.

**Traspassos.** Dins d'un mateix espai, moure diners entre dos comptes seus no és ni ingrés
ni despesa: els imports oposats dins de tres dies s'aparellen i queden fora dels informes.
El que arriba **d'un altre espai**, en canvi, sí que compta: per a qui mira Calella, uns
diners que hi entren són una entrada de debò.

## Provar-ho ara mateix

Amb Docker, sense credencials del banc ni túnel:

```bash
make up      # arrenca-ho tot
make demo    # 18 mesos de moviments d'exemple
```

Obre **http://localhost:8080** i entra amb `demo@exemple.cat` / `comptabilitat`.
Els detalls, i com fer-ho sense Docker, a [`docs/provar-en-local.md`](docs/provar-en-local.md).

## Posada en marxa de debò

- **Com funcionen els espais**: [`docs/espais.md`](docs/espais.md)
- **Al NAS**: [`docs/desplegament.md`](docs/desplegament.md)
- **Enable Banking**: [`docs/enable-banking.md`](docs/enable-banking.md)
- **Dia a dia**: [`docs/operacio.md`](docs/operacio.md)

## Proves

Després de qualsevol canvi, una sola ordre:

```bash
bun run ok    # comprovacions + la tanda que no vol base de dades. Un segon
```

Si falla, diu quina passa ha fallat i què has de fer.

`test:unitat` són `htmx-contract/` i `tests/unitat/`: el marcatge, la
normalització, les exportacions i el contracte d'HTMX. No toquen la base de
dades, i a la integració contínua corren en una feina **sense cap servei de
PostgreSQL**, que és el que manté honesta la separació.

La resta de proves sí que en volen una, a part:

```bash
createdb comptabilitat_test
export DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
bun run test:bd
```

**Fes servir `bun run test:bd`, no `bun test` a seques.** Les migracions
s'apliquen en importar `src/server.ts`, i deu fitxers de proves l'importen: en
una base de dades acabada de crear, es posen a migrar tots alhora i xoquen entre
ells. El resultat és una primera passada amb una dotzena d'errors que no tenen
res a veure amb el teu canvi. `test:bd` fa el que fa la integració contínua
—aplicar les migracions primer i després `SKIP_MIGRATIONS=true`—, i llavors surt
verd. Amb la base de dades ja migrada, `bun test` també va.

Cap prova no toca res de fora: el banc, el servidor de correu i el model local
són servidors locals muntats per la prova mateixa.

Les que valen més són les que fixen el comportament que costaria de
redescobrir: la normalització dels conceptes i les claus de deduplicació es
comproven contra la sortida gravada de la implementació anterior, i
`tests/espais.test.ts` comprova que qui no té accés a un espai rep exactament
la mateixa resposta que si no existís.
