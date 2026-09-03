#!/usr/bin/env bash
# Desplega Comptabilitat al NAS: sincronitza fitxers, arrenca l'stack i connecta el túnel.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"
NAS_HOST="${NAS_HOST:-nyaspa}"
NAS_PATH="${NAS_PATH:-~/code/comptabilitat}"

usage() {
  cat <<EOF
Ús: $(basename "$0") [opcions]

Opcions:
  --local       Desplega en aquesta màquina (sense rsync al NAS)
  --build       Força rebuild de les imatges
  --admin EMAIL Crea l'administrador després del desplegament

Variables d'entorn:
  NAS_HOST      Host SSH del NAS (per defecte: nyaspa)
  NAS_PATH      Ruta del repositori al NAS

EOF
}

LOCAL=false
BUILD=""
ADMIN_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL=true; shift ;;
    --build) BUILD="--build"; shift ;;
    --admin) ADMIN_EMAIL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opció desconeguda: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ! -f "${DEPLOY_DIR}/.env" ]]; then
  echo "ERROR: Falta ${DEPLOY_DIR}/.env — copia .env.example i omple els valors." >&2
  exit 1
fi

if [[ ! -f "${DEPLOY_DIR}/secrets/eb_private_key.pem" ]]; then
  echo "ERROR: Falta ${DEPLOY_DIR}/secrets/eb_private_key.pem" >&2
  exit 1
fi

if [[ "$LOCAL" == false ]]; then
  echo "==> Sincronitzant al NAS (${NAS_HOST}:${NAS_PATH})..."
  rsync -avz --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.venv' \
    --exclude 'deploy/backups/*.sql.gz' \
    "${REPO_ROOT}/" "${NAS_HOST}:${NAS_PATH}/"

  echo "==> Desplegant al NAS..."
  ssh "${NAS_HOST}" "cd ${NAS_PATH}/deploy && docker compose up -d ${BUILD}"

  echo "==> Connectant cloudflared..."
  ssh "${NAS_HOST}" "cd ${NAS_PATH}/deploy && bash scripts/connect-tunnel.sh"

  if [[ -n "$ADMIN_EMAIL" ]]; then
    ssh "${NAS_HOST}" "cd ${NAS_PATH}/deploy && bash scripts/setup-admin.sh '${ADMIN_EMAIL}'"
  fi
else
  echo "==> Desplegament local..."
  cd "${DEPLOY_DIR}"
  docker compose up -d ${BUILD}

  echo "==> Connectant cloudflared (si n'hi ha un al host)..."
  bash scripts/connect-tunnel.sh || true

  if [[ -n "$ADMIN_EMAIL" ]]; then
    bash scripts/setup-admin.sh "${ADMIN_EMAIL}"
  fi
fi

PUBLIC_URL="$(grep '^PUBLIC_BASE_URL=' "${DEPLOY_DIR}/.env" | cut -d= -f2-)"
echo ""
echo "=== Desplegament completat ==="
echo "URL: ${PUBLIC_URL}"
echo "Health: curl -s ${PUBLIC_URL}/salut"
