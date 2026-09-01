#!/usr/bin/env bash
# Actualitza EB_APPLICATION_ID al stack de Portainer i el redesplega.
set -euo pipefail

APP_ID="${1:-}"
if [[ -z "$APP_ID" ]]; then
  echo "Ús: $0 <EB_APPLICATION_ID>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
if grep -q '^EB_APPLICATION_ID=' "$ENV_FILE"; then
  sed -i "s/^EB_APPLICATION_ID=.*/EB_APPLICATION_ID=${APP_ID}/" "$ENV_FILE"
else
  echo "EB_APPLICATION_ID=${APP_ID}" >> "$ENV_FILE"
fi

export PORTAINER_PASSWORD="${PORTAINER_PASSWORD:?cal PORTAINER_PASSWORD}"
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}"
python3 "$ROOT/deploy/scripts/portainer-deploy.py"
echo "Fet. Prova: curl -s https://comptabilitat.dossierapp.org/api/health"
