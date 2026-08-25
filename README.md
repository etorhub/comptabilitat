# Comptabilitat

Gestor de comptabilitat personal i familiar autoallotjat. Importa els moviments dels
comptes bancaris a través de l'API d'[Enable Banking](https://enablebanking.com), els
classifica (amb ajuda d'un model local via Ollama), i mostra saldos, gràfiques, moviments
recurrents, previsions de descobert i informes exportables.

Hi conviuen tres llibres comptables independents — **Personal**, **Calella** i
**Pardals** — amb una vista consolidada per damunt, i permisos per llibre per a cada
persona de la família.

## Estructura

| Directori | Contingut |
|---|---|
| `backend/` | API FastAPI, models SQLAlchemy, migracions Alembic i feines programades |
| `frontend/` | Interfície React + TypeScript |
| `deploy/` | Stack de Docker Compose per a Portainer, túnel de Cloudflare i còpies |
| `docs/` | Enable Banking, desplegament i operació |

## Com funciona

**Importació.** Un cop al dia, el `worker` demana al banc els moviments des de l'última
data coneguda menys una setmana de marge. Els apunts es dedupliquen per la referència que
dona el banc o, si no n'hi ha, per un resum estable de les dades que no canvien. Els
moviments pendents es reconcilien amb el seu apunt definitiu en comptes de duplicar-se, i
conserven la categoria que hi haguessis posat.

**Classificació.** L'ordre és sempre el mateix, del més barat i explícit al més car: el que
has decidit tu (que no es toca mai), les regles per prioritat, la memòria de comerços i,
només per als comerços que no han encaixat enlloc, el model local. La resta va a la safata
de revisió. Quan corregeixes una categoria, la decisió es recorda per a tot el comerç.

**El model local classifica per comerç, no per moviment.** És el que fa viable un NAS sense
targeta gràfica: en règim normal apareixen pocs comerços nous cada nit, i un cop resolts no
es tornen a preguntar mai més.

**Previsió.** Les sèries recurrents es detecten per la regularitat dels intervals i
l'estabilitat de l'import. A partir d'aquí, el saldo es projecta a 90 dies sumant els
rebuts previstos i restant una deriva de despesa variable calculada amb els imports
extrems descartats, en banda esperada, optimista i pessimista.

**Traspassos.** Moure diners entre comptes propis no és ni ingrés ni despesa: els imports
oposats en comptes diferents dins de tres dies s'aparellen i queden fora dels informes.

## Posada en marxa

- **Al NAS**: [`docs/desplegament.md`](docs/desplegament.md)
- **Enable Banking**: [`docs/enable-banking.md`](docs/enable-banking.md)
- **Dia a dia**: [`docs/operacio.md`](docs/operacio.md)

### En local

```bash
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
docker run -d --name comptabilitat-db -e POSTGRES_USER=comptabilitat \
  -e POSTGRES_PASSWORD=comptabilitat -e POSTGRES_DB=comptabilitat \
  -p 5432:5432 postgres:16-alpine

export DATABASE_URL="postgresql+psycopg://comptabilitat:comptabilitat@localhost:5432/comptabilitat"
export COOKIE_SECURE=false
cd backend && alembic upgrade head && python -m app.cli init
python -m app.cli create-user --email tu@example.com --admin
uvicorn app.main:app --reload
```

I en un altre terminal, `cd frontend && npm install && npm run dev`.

## Proves

```bash
cd backend && python -m pytest        # cal un PostgreSQL accessible
ruff check . && ruff format --check .
cd ../frontend && npm run build
```

Les proves creen la seva pròpia base de dades (`comptabilitat_test`) i cada prova va dins
d'una transacció que es desfà en acabar. La URL es pot canviar amb `DATABASE_URL`.

El client d'Enable Banking i el d'Ollama es proven contra respostes gravades, de manera que
la bateria no toca cap servei extern.
