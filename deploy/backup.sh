#!/bin/sh
# Copia diaria de la base de dades amb rotacio.
set -e
RETENTION="${BACKUP_RETENTION_DAYS:-30}"

while true; do
  STAMP=$(date +%Y%m%d-%H%M%S)
  TARGET="/backups/comptabilitat-${STAMP}.sql.gz"
  echo "[backup] generant ${TARGET}"
  if pg_dump --no-owner | gzip -9 > "${TARGET}.tmp"; then
    mv "${TARGET}.tmp" "${TARGET}"
    find /backups -name 'comptabilitat-*.sql.gz' -mtime "+${RETENTION}" -delete
    echo "[backup] fet"
  else
    rm -f "${TARGET}.tmp"
    echo "[backup] ha fallat" >&2
  fi
  sleep 86400
done
