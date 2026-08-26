# Desplegament al NAS amb Portainer i Cloudflare

El NAS és un UGREEN DXP2800 (Intel N100, 16 GB). L'stack no publica cap port: l'únic camí
d'entrada és el túnel de Cloudflare.

```
Internet ──▶ Cloudflare ──▶ cloudflared ──▶ web (nginx) ──┬──▶ api ──▶ db
                                                          └──▶ (estàtics)
                                            worker ──▶ api/db i, opcionalment, ollama
```

## 1. Túnel de Cloudflare

Al [tauler de Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Networks** →
**Tunnels**:

1. **Create a tunnel** → tipus **Cloudflared** → posa-li nom (per exemple `nas`).
2. Copia el **token** del túnel: anirà a `CLOUDFLARE_TUNNEL_TOKEN`.
3. A **Public hostnames**, afegeix-ne un:
   - **Subdomain**: `comptes` (o el que vulguis)
   - **Domain**: el teu domini
   - **Service**: `http://web:8080`

No cal obrir cap port al router ni tocar el tallafoc del NAS.

### Cloudflare Access (recomanat)

A **Zero Trust** → **Access** → **Applications**, afegeix el hostname com a aplicació
self-hosted amb una política que només permeti el teu correu (one-time PIN). Queda una
segona capa per davant del login de l'aplicació.

Això **no trenca el retorn del banc**: qui torna del Santander és el teu navegador, que ja
té sessió d'Access. No cal cap regla de bypass per a `/api/auth/callback`.

## 2. Preparar els fitxers

Al NAS, on tinguis el repositori clonat:

```bash
cp deploy/.env.example deploy/.env
openssl rand -hex 32           # per a SECRET_KEY
cp /on/tinguis/la/clau.pem deploy/secrets/eb_private_key.pem
chmod 600 deploy/secrets/eb_private_key.pem
```

Omple `deploy/.env`. Els que no poden quedar buits:

| Variable | Per a què serveix |
|---|---|
| `POSTGRES_PASSWORD` | Contrasenya de la base de dades |
| `SECRET_KEY` | Signatura de les sessions |
| `PUBLIC_BASE_URL` | `https://comptes.el-teu-domini` — ha de coincidir amb el túnel i amb el redirect d'Enable Banking |
| `EB_APPLICATION_ID` | Identificador de l'aplicació d'Enable Banking |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token del túnel |
| `SMTP_*` i `ALERT_RECIPIENTS` | Per rebre els avisos per correu |

## 3. Desplegar l'stack

A Portainer → **Stacks** → **Add stack**:

- **Build method**: *Repository*
- **Repository URL**: el d'aquest projecte
- **Compose path**: `deploy/docker-compose.yml`
- Carrega les variables des de `deploy/.env`

O per línia d'ordres:

```bash
cd deploy && docker compose up -d --build
```

Amb el model local (opcional, vegeu més avall):

```bash
docker compose --profile ai up -d --build
```

Què fa cada servei:

| Servei | Xarxa | Notes |
|---|---|---|
| `db` | interna | PostgreSQL 16 amb volum persistent |
| `api` | interna | Aplica les migracions i sembra els espais i les seves categories en arrencar |
| `worker` | interna + externa | Feines programades; necessita sortida per parlar amb el banc i l'SMTP |
| `web` | interna | nginx amb l'aplicació i el proxy cap a `api` |
| `cloudflared` | interna + externa | Túnel |
| `backup` | interna | `pg_dump` diari a `deploy/backups/` |
| `ollama` | interna | Només amb el perfil `ai` |

La xarxa `interna` està marcada com a `internal: true`: la base de dades i l'API no tenen
sortida a internet.

## 4. Primer usuari

```bash
docker compose exec api python -m app.cli create-user \
  --email tu@example.com --name "El teu nom" --admin
```

Demana la contrasenya de manera interactiva (mínim 10 caràcters). Per a la resta de la
família, des de la interfície o bé:

```bash
docker compose exec api python -m app.cli create-user --email parella@example.com
docker compose exec api python -m app.cli grant --email parella@example.com \
  --ledger pardals --role editor
```

Els rols per espai són `viewer` (només mirar), `editor` (categoritzar i anotar) i `admin`
(a més, configurar l'espai). **Ser administrador de l'aplicació no dona accés a cap espai**:
també te l'has de concedir a tu mateix. Vegeu [`espais.md`](espais.md).

```bash
docker compose exec api python -m app.cli grant --email tu@example.com --ledger personal --role admin
docker compose exec api python -m app.cli grant --email tu@example.com --ledger calella --role admin
docker compose exec api python -m app.cli grant --email tu@example.com --ledger pardals --role admin
```

## 5. Model local amb Ollama (opcional)

L'N100 no té targeta gràfica, així que cal un model petit i feina en lots de matinada:

```bash
docker compose --profile ai up -d ollama
docker compose exec ollama ollama pull qwen3:4b
```

I a `deploy/.env`:

```ini
OLLAMA_ENABLED=true
OLLAMA_MODEL=qwen3:4b
```

Recorda que **es classifica per comerç, no per moviment**: un cop un comerç està resolt,
no es torna a preguntar mai més. En règim normal són pocs comerços nous cada nit, i per
això la lentitud del processador no molesta.

Si el model va massa lent, prova `llama3.2:3b`. Si prefereixes no fer-lo servir, deixa
`OLLAMA_ENABLED=false`: tot funciona igual amb regles i memòria de comerços, només que hi
haurà més coses a la safata de revisió.

## 6. Comprovacions després de desplegar

```bash
docker compose ps                      # tots amb estat healthy
docker compose logs -f api             # migracions aplicades i servidor amunt
curl -s https://comptes.el-teu-domini/api/health
docker compose logs worker | head -20  # les feines programades i els seus horaris
```

Després, al navegador: entra, ves a **Connexions** i segueix
[la posada en marxa d'Enable Banking](enable-banking.md). En connectar el banc hauràs
d'assignar cada compte al seu espai.

## 7. Desenvolupament en local

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

I en un altre terminal:

```bash
cd frontend && npm install && npm run dev
```

El servidor de Vite reenvia `/api` cap a `http://localhost:8000` (o cap a `API_URL`).
