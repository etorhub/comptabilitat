# Provar-ho a la teva màquina

Aquesta és la via curta per veure l'aplicació funcionant abans de tocar res del NAS: **no
cal ni el túnel de Cloudflare ni cap credencial d'Enable Banking**.

## El que necessites

Docker amb el plugin Compose. Res més. A macOS, Docker Desktop; a Linux, `docker` i
`docker-compose-plugin`. Comprova-ho amb:

```bash
docker compose version
```

## Tres ordres

```bash
git clone https://github.com/etorhub/comptabilitat.git
cd comptabilitat
make up      # construeix i arrenca (la primera vegada triga uns minuts)
make demo    # omple la base de dades amb 18 mesos de moviments d'exemple
```

Obre **http://localhost:8080** i entra amb:

```
demo@exemple.cat
comptabilitat
```

La demo crea tres usuaris amb accessos diferents, per veure com funcionen els espais
estancs. Tots tres tenen la contrasenya `comptabilitat`:

| Usuari | On entra |
|---|---|
| `demo@exemple.cat` | Personal, Calella i Pardals |
| `parella@exemple.cat` | Només Pardals |
| `sogra@exemple.cat` | Només Calella |

Val la pena entrar amb la sogra i comprovar que no veu ni el selector d'altres espais ni
res del teu Personal.

Si prefereixes no fer servir `make`:

```bash
docker compose -f deploy/docker-compose.local.yml up -d --build
docker compose -f deploy/docker-compose.local.yml exec app bun run cli demo
```

## Què hi trobaràs

Les dades d'exemple imiten el que arriba del Santander (`COMPRA TARJ. 5402XXXXXXXX1234 EN
MERCADONA, BARCELONA` i companyia), repartides pels tres espais:

- **El selector d'espai** a dalt de tot de la barra lateral: tot el que hi ha a sota és
  d'un sol espai, mai barrejat.
- **Panell**: saldo, ingressos i despeses del mes, evolució i repartiment per categoria.
- **Moviments**: uns 300 apunts per espai amb filtres, edició de categoria i exportació a
  CSV i Excel.
- **Recurrents**: set rebuts detectats sols (Endesa, Netflix, Spotify, comunitat, Agbar,
  assegurança i la nòmina), amb el cost mensual i la propera data prevista.
- **Previsió**: projecció a 90 dies amb els rebuts previstos i la banda de despesa variable.
- **Informes**: comparativa mes a mes i exportació a Excel i PDF.
- **Comerços** i **Regles**: la memòria de l'espai i les regles que la governen.
- **Configuració**: el nom i el color de l'espai, el llindar de descobert, qui rep els
  avisos i qui hi té accés.

Val la pena provar el cicle que faràs de debò: ves a **Moviments**, canvia la categoria
d'un moviment i mira com la resta de moviments del mateix comerç canvien també — i com el
mateix comerç en un altre espai **no** es mou.

També hi ha un moviment de 400 € que va de Personal a Calella: el veuràs com una sortida a
Personal i com una entrada a Calella, sense aparellar-se. És el que toca amb comptabilitats
separades.

## Altres ordres

```bash
make logs    # segueix els registres de l'aplicació
make shell   # consola de PostgreSQL
make down    # atura, conservant les dades
make clean   # atura i esborra les dades (per començar de zero)
```

Les feines programades no corren soles en local. Per llançar-ne una a mà:

```bash
docker compose -f deploy/docker-compose.local.yml exec app bun run jobs analyze
```

I si en vols el planificador de debò, `--profile cron`.

## Provar el sandbox d'Enable Banking

Si ja tens l'`application_id` i la clau privada de sandbox, pots provar el flux
d'autorització sencer contra un banc simulat. Al panell d'Enable Banking, posa com a
redirect URL:

```
http://localhost:8080/api/auth/callback
```

(Aquesta adreça no canvia amb el canvi de pila: és la mateixa que ja tinguis donada d'alta.)

I arrenca amb les credencials a l'entorn:

```bash
export EB_APPLICATION_ID="el-teu-application-id"
export EB_PRIVATE_KEY="$(cat /on/tinguis/la/clau.pem)"
make up
```

Després, a **Connexions** → **Connecta un banc**. Amb el sandbox pots recórrer
l'autorització, el retorn i la importació sense tocar dades reals.

> Nota: `demo` i les dades reals no es barregen bé. Si has fet `make demo` i després vols
> provar el banc, fes `make clean` primer.

## Sense Docker

Si prefereixes executar-ho directament:

Només cal [Bun](https://bun.sh) i un PostgreSQL:

```bash
docker run -d --name comptabilitat-db -e POSTGRES_USER=comptabilitat \
  -e POSTGRES_PASSWORD=comptabilitat -e POSTGRES_DB=comptabilitat \
  -p 5432:5432 postgres:16-alpine

bun install
bun run css     # compila public/app.css

export DATABASE_URL="postgresql://comptabilitat:comptabilitat@localhost:5432/comptabilitat"
export SECRET_KEY="una-clau-qualsevol-de-32-caracters-o-mes"
export COOKIE_SECURE=false ENVIRONMENT=local DEBUG=true
export PUBLIC_BASE_URL=http://localhost:8000

bun run cli demo   # aplica les migracions i omple la base de dades
bun run dev
```

L'aplicació queda a **http://localhost:8000**, sencera: no hi ha res més a arrencar. Amb
`bun run dev` el servidor es recarrega sol quan toques un fitxer; per veure els canvis del
full d'estil, `bun run css:watch` en un altre terminal.

## Si alguna cosa no va

| Símptoma | Causa i solució |
|---|---|
| `port is already allocated` | Ja tens alguna cosa al 8080 o al 5432. Atura-ho, o canvia el port a `deploy/docker-compose.local.yml` |
| La pàgina carrega però no entra | Mira `make logs`; si encara s'apliquen migracions, espera uns segons |
| Es veu sense estils | Falta `public/app.css`. Amb Docker es compila a la imatge; sense Docker, `bun run css` |
| `ja hi havia dades` en fer `make demo` | Ja n'hi ha; per començar de zero, `make clean && make up && make demo` |
| Vols un usuari propi | `make usuari EMAIL=tu@example.com PASSWORD=unacontrasenyallarga` |
