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
git checkout claude/personal-accounting-manager-kj2wij

make up      # construeix i arrenca (la primera vegada triga uns minuts)
make demo    # omple la base de dades amb 18 mesos de moviments d'exemple
```

Obre **http://localhost:8080** i entra amb:

```
demo@exemple.cat
comptabilitat
```

Si prefereixes no fer servir `make`:

```bash
docker compose -f deploy/docker-compose.local.yml up -d --build
docker compose -f deploy/docker-compose.local.yml exec api python -m app.cli demo
```

## Què hi trobaràs

Les dades d'exemple imiten el que arriba del Santander (`COMPRA TARJ. 5402XXXXXXXX1234 EN
MERCADONA, BARCELONA` i companyia), repartides pels tres llibres:

- **Panell**: saldos, ingressos i despeses del mes, evolució i repartiment per categoria.
- **Moviments**: 350 apunts amb filtres, edició de categoria i exportació a CSV i Excel.
- **Recurrents**: set rebuts detectats sols (Endesa, Netflix, Spotify, comunitat, Agbar,
  assegurança i la nòmina), amb el cost mensual i la propera data prevista.
- **Previsió**: projecció a 90 dies amb els rebuts previstos i la banda de despesa variable.
- **Informes**: comparativa mes a mes i exportació a Excel i PDF.
- **Configuració**: els comerços amb la seva categoria i les regles.

Val la pena provar el cicle que faràs de debò: ves a **Moviments**, canvia la categoria
d'un moviment i mira com la resta de moviments del mateix comerç canvien també.

## Altres ordres

```bash
make logs    # segueix els registres de l'API
make shell   # consola de PostgreSQL
make down    # atura, conservant les dades
make clean   # atura i esborra les dades (per començar de zero)
```

L'API queda també a http://localhost:8000 i, com que en local `DEBUG=true`, la
documentació interactiva és a **http://localhost:8000/api/docs**.

## Provar el sandbox d'Enable Banking

Si ja tens l'`application_id` i la clau privada de sandbox, pots provar el flux
d'autorització sencer contra un banc simulat. Al panell d'Enable Banking, posa com a
redirect URL:

```
http://localhost:8080/api/auth/callback
```

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

```bash
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
docker run -d --name comptabilitat-db -e POSTGRES_USER=comptabilitat \
  -e POSTGRES_PASSWORD=comptabilitat -e POSTGRES_DB=comptabilitat \
  -p 5432:5432 postgres:16-alpine

export DATABASE_URL="postgresql+psycopg://comptabilitat:comptabilitat@localhost:5432/comptabilitat"
export COOKIE_SECURE=false ENVIRONMENT=local DEBUG=true
cd backend && alembic upgrade head && python -m app.cli demo
uvicorn app.main:app --reload
```

I en un altre terminal:

```bash
cd frontend && npm install && npm run dev
```

L'aplicació queda a http://localhost:5173 i el servidor de Vite reenvia `/api` cap al
backend.

## Si alguna cosa no va

| Símptoma | Causa i solució |
|---|---|
| `port is already allocated` | Ja tens alguna cosa al 8080, 8000 o 5432. Atura-ho, o canvia el port a `deploy/docker-compose.local.yml` |
| La pàgina carrega però no entra | Mira `make logs`; si l'API encara aplica migracions, espera uns segons |
| `ja hi havia dades` en fer `make demo` | Ja n'hi ha; per començar de zero, `make clean && make up && make demo` |
| Vols un usuari propi | `make usuari EMAIL=tu@example.com PASSWORD=unacontrasenyallarga` |
