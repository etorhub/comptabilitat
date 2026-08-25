# Comptabilitat

Gestor de comptabilitat personal i familiar autoallotjat. Importa els moviments dels
comptes bancaris a través de l'API d'[Enable Banking](https://enablebanking.com), els
classifica (amb ajuda d'un model local via Ollama), i mostra saldos, gràfiques,
moviments recurrents, previsions de descobert i informes exportables.

Hi conviuen tres llibres comptables independents — **Personal**, **Calella** i
**Pardals** — amb una vista consolidada per damunt.

## Estructura

| Directori | Contingut |
|---|---|
| `backend/` | API FastAPI, models SQLAlchemy, migracions Alembic i feines programades |
| `frontend/` | Interfície React + TypeScript |
| `deploy/` | Stack de Docker Compose per a Portainer, túnel de Cloudflare i còpies |
| `docs/` | Posada en marxa, Enable Banking, Cloudflare i operació |

## Posada en marxa ràpida (desenvolupament)

```bash
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
export DATABASE_URL="postgresql+psycopg://comptabilitat:comptabilitat@localhost:5432/comptabilitat"
cd backend && alembic upgrade head
python -m app.cli init
python -m app.cli create-user --email tu@example.com --admin
uvicorn app.main:app --reload
```

Al davant, `cd frontend && npm install && npm run dev`.

## Desplegament al NAS

Vegeu [`docs/desplegament.md`](docs/desplegament.md). En resum: copiar
`deploy/.env.example` a `deploy/.env`, deixar la clau privada d'Enable Banking a
`deploy/secrets/eb_private_key.pem`, i desplegar `deploy/docker-compose.yml` com a stack
de Portainer.

## Documentació

- [Posada en marxa d'Enable Banking](docs/enable-banking.md)
- [Desplegament amb Portainer i Cloudflare](docs/desplegament.md)
- [Operació: còpies, avisos i manteniment](docs/operacio.md)
