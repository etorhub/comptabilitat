#!/bin/sh
# Punt d'entrada compartit pel servidor web i pel planificador.
set -e

espera_la_base_de_dades() {
  i=0
  until bun -e '
    import { db, closeDb } from "./src/db/client.ts";
    import { sql } from "drizzle-orm";
    await db.execute(sql`select 1`);
    await closeDb();
  ' >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      echo "La base de dades no respon" >&2
      exit 1
    fi
    echo "Esperant la base de dades ($i/60)…"
    sleep 2
  done
}

case "$1" in
  app)
    espera_la_base_de_dades
    # Nomes el servidor web aplica les migracions, per no fer-les dues
    # vegades alhora.
    exec bun run src/server.ts
    ;;
  worker)
    espera_la_base_de_dades
    # El planificador no les aplica: espera que el servidor ho hagi fet.
    export SKIP_MIGRATIONS=true
    exec bun run src/workers/scheduler.ts
    ;;
  *)
    exec "$@"
    ;;
esac
