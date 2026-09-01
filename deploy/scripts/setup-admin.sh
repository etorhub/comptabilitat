#!/usr/bin/env bash
# Primer usuari i permisos d'espais després del desplegament.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

EMAIL="${1:-}"
NAME="${2:-Administrador}"
PASSWORD="${3:-}"

if [[ -z "$EMAIL" ]]; then
  read -rp "Correu de l'administrador: " EMAIL
fi

if [[ -z "$PASSWORD" ]]; then
  PASSWORD="$(openssl rand -base64 18)"
  GENERATED=true
else
  GENERATED=false
fi

echo "==> Creant usuari administrador ${EMAIL}..."
docker compose exec -T api python -m app.cli create-user \
  --email "$EMAIL" --name "$NAME" --admin --password "$PASSWORD"

echo "==> Atorgant accés als tres espais..."
for ledger in personal calella pardals; do
  docker compose exec -T api python -m app.cli grant \
    --email "$EMAIL" --ledger "$ledger" --role admin
  echo "    ${ledger}: admin"
done

echo ""
echo "=== Següents passos ==="
if [[ "${GENERATED:-false}" == true ]]; then
  echo "Contrasenya generada: ${PASSWORD}"
fi
echo "1. Entra a \${PUBLIC_BASE_URL:-la URL publica} amb ${EMAIL}"
echo "2. Ves a Connexions → Connecta un banc"
echo "3. Assigna cada compte al seu espai i prem Sincronitza"
