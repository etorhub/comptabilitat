#!/bin/sh
# Punt d'entrada compartit pels contenidors api i worker.
set -e

wait_for_db() {
  python - <<'PY'
import sys, time
import sqlalchemy as sa
from app.config import settings

for attempt in range(60):
    try:
        engine = sa.create_engine(settings.database_url)
        with engine.connect() as connection:
            connection.execute(sa.text("SELECT 1"))
        engine.dispose()
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        print(f"Esperant la base de dades ({attempt + 1}/60): {exc}", flush=True)
        time.sleep(2)
print("La base de dades no respon", file=sys.stderr)
sys.exit(1)
PY
}

case "$1" in
  api)
    wait_for_db
    # Nomes l'API aplica les migracions, per no fer-les dues vegades alhora.
    alembic upgrade head
    python -m app.cli init
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
    ;;
  worker)
    wait_for_db
    exec python -m app.workers.scheduler
    ;;
  *)
    exec "$@"
    ;;
esac
