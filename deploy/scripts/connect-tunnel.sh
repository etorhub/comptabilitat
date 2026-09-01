#!/usr/bin/env bash
# Connecta el cloudflared existent del NAS a la xarxa de l'stack Comptabilitat.
# Executa des del NAS (SSH o terminal de Portainer) després que l'stack estigui amunt.
set -euo pipefail

STACK_NAME="${STACK_NAME:-comptabilitat}"
NETWORK="${STACK_NAME}_interna"
WEB_HOST="${WEB_HOST:-web}"
WEB_PORT="${WEB_PORT:-8080}"

echo "==> Cercant contenidors cloudflared..."
mapfile -t TUNNELS < <(docker ps --format '{{.Names}}' | grep -i cloudflared || true)
if [[ ${#TUNNELS[@]} -eq 0 ]]; then
  echo "ERROR: No s'ha trobat cap contenidor cloudflared en execució." >&2
  echo "Llista de contenidors:" >&2
  docker ps --format '  {{.Names}}' >&2
  exit 1
fi

if [[ ${#TUNNELS[@]} -gt 1 ]]; then
  echo "S'han trobat diversos contenidors cloudflared:"
  for i in "${!TUNNELS[@]}"; do
    echo "  [$i] ${TUNNELS[$i]}"
  done
  read -rp "Quin vols connectar? [0]: " idx
  idx="${idx:-0}"
  CLOUDFLARED="${TUNNELS[$idx]}"
else
  CLOUDFLARED="${TUNNELS[0]}"
fi

echo "==> Comprovant la xarxa ${NETWORK}..."
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "ERROR: La xarxa ${NETWORK} no existeix. Has desplegat l'stack ${STACK_NAME}?" >&2
  docker network ls | grep -i comptabilitat || true
  exit 1
fi

echo "==> Connectant ${CLOUDFLARED} a ${NETWORK}..."
if docker network inspect "$NETWORK" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$CLOUDFLARED"; then
  echo "    Ja connectat."
else
  docker network connect "$NETWORK" "$CLOUDFLARED"
  echo "    Connectat."
fi

echo "==> Resolent el hostname del servei web..."
mapfile -t WEB_CONTAINERS < <(
  docker network inspect "$NETWORK" --format '{{range $k, $v := .Containers}}{{$v.Name}}{{"\n"}}{{end}}' \
    | grep -E 'web|nginx' || true
)
if [[ ${#WEB_CONTAINERS[@]} -eq 0 ]]; then
  WEB_TARGET="${WEB_HOST}:${WEB_PORT}"
else
  WEB_TARGET="${WEB_CONTAINERS[0]}:${WEB_PORT}"
fi

echo ""
echo "=== Cloudflare tunnel ==="
echo "A Zero Trust → Tunnels → Public Hostnames, afegeix o actualitza:"
echo ""
echo "  Service URL: http://${WEB_TARGET}"
echo ""
echo "PUBLIC_BASE_URL ha de coincidir amb el hostname del túnel."
echo "Prova des del NAS:"
echo "  docker exec ${CLOUDFLARED} wget -qO- http://${WEB_TARGET}/healthz || true"
