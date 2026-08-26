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

| Directori | Contingut |
|---|---|
| `backend/` | API FastAPI, models SQLAlchemy, migracions Alembic i feines programades |
| `frontend/` | Interfície React + TypeScript |
| `deploy/` | Stacks de Docker Compose (producció i local), túnel de Cloudflare i còpies |
| `docs/` | Espais, provar-ho en local, Enable Banking, desplegament i operació |

## Com funciona

**Importació.** Un cop al dia, el `worker` demana al banc els moviments des de l'última
data coneguda menys una setmana de marge. Els apunts es dedupliquen per la referència que
dona el banc o, si no n'hi ha, per un resum estable de les dades que no canvien. Els
moviments pendents es reconcilien amb el seu apunt definitiu en comptes de duplicar-se, i
conserven la categoria que hi haguessis posat.

**Classificació.** Dins de cada espai, l'ordre és sempre el mateix, del més barat i explícit
al més car: el que has decidit tu (que no es toca mai), les regles per prioritat, la memòria
de comerços i, només per als comerços que no han encaixat enlloc, el model local. La resta
va a la safata de revisió. Quan corregeixes una categoria, la decisió es recorda per a tot
el comerç **d'aquell espai**: la sogra classificant a Calella no toca res del teu Personal.

**El model local classifica per comerç, no per moviment.** És el que fa viable un NAS sense
targeta gràfica: en règim normal apareixen pocs comerços nous cada nit, i un cop resolts no
es tornen a preguntar mai més.

**Previsió.** Les sèries recurrents es detecten per la regularitat dels intervals i
l'estabilitat de l'import. A partir d'aquí, el saldo es projecta a 90 dies sumant els
rebuts previstos i restant una deriva de despesa variable calculada amb els imports
extrems descartats, en banda esperada, optimista i pessimista.

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

```bash
cd backend && python -m pytest        # cal un PostgreSQL accessible
ruff check . && ruff format --check .
cd ../frontend && npm run build
```

Les proves creen la seva pròpia base de dades (`comptabilitat_test`) i cada prova va dins
d'una transacció que es desfà en acabar. La URL es pot canviar amb `DATABASE_URL`.

El client d'Enable Banking i el d'Ollama es proven contra respostes gravades, de manera que
la bateria no toca cap servei extern.
