#!/usr/bin/env python3
"""Deploy or update the comptabilitat Portainer stack."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY_DIR = ROOT / "deploy"
ENV_FILE = DEPLOY_DIR / ".env"
SECRET_FILE = DEPLOY_DIR / "secrets" / "eb_private_key.pem"

PORTAINER_URL = os.environ.get("PORTAINER_URL", "http://192.168.0.10:9000").rstrip("/")
ENDPOINT_ID = int(os.environ.get("PORTAINER_ENDPOINT_ID", "3"))
STACK_NAME = os.environ.get("STACK_NAME", "comptabilitat")
REPO_URL = os.environ.get("REPO_URL", "https://github.com/etorhub/comptabilitat")
REPO_REF = os.environ.get("REPO_REF", "refs/heads/master")
COMPOSE_PATH = os.environ.get("COMPOSE_PATH", "deploy/docker-compose.yml")


def request(method: str, path: str, headers: dict | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{PORTAINER_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def auth_headers() -> dict[str, str]:
    api_key = os.environ.get("PORTAINER_API_KEY")
    if api_key:
        return {"X-API-Key": api_key}
    user = os.environ.get("PORTAINER_USER", "admin")
    password = os.environ.get("PORTAINER_PASSWORD")
    if not password:
        print("Set PORTAINER_PASSWORD or PORTAINER_API_KEY", file=sys.stderr)
        sys.exit(1)
    token = request("POST", "/api/auth", body={"Username": user, "Password": password})["jwt"]
    return {"Authorization": f"Bearer {token}"}


def load_env() -> list[dict[str, str]]:
    if not ENV_FILE.is_file():
        print(f"Missing {ENV_FILE}", file=sys.stderr)
        sys.exit(1)
    env_map: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        env_map[name] = value

    if SECRET_FILE.is_file():
        env_map["EB_PRIVATE_KEY"] = SECRET_FILE.read_text().strip()

    return [{"name": k, "value": v} for k, v in env_map.items()]


def docker_get(path: str, headers: dict[str, str]):
    req = urllib.request.Request(
        f"{PORTAINER_URL}/api/endpoints/{ENDPOINT_ID}/docker{path}",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def docker_post(path: str, headers: dict[str, str], body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{PORTAINER_URL}/api/endpoints/{ENDPOINT_ID}/docker{path}",
        data=data,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def wait_for_containers(headers: dict[str, str], timeout: int = 600) -> None:
    deadline = time.time() + timeout
    wanted = {"comptabilitat-api-1", "comptabilitat-web-1", "comptabilitat-worker-1"}
    while time.time() < deadline:
        containers = docker_get("/containers/json?all=1", headers)
        names = {c["Names"][0].lstrip("/") for c in containers}
        running = {
            c["Names"][0].lstrip("/")
            for c in containers
            if c["State"] == "running" and c["Names"][0].lstrip("/") in wanted
        }
        if wanted.issubset(running):
            print("All core containers running.")
            return
        missing = wanted - running
        print(f"Waiting for containers: {', '.join(sorted(missing))}")
        time.sleep(15)
    raise TimeoutError("Timed out waiting for comptabilitat containers")


def connect_cloudflared(headers: dict[str, str]) -> None:
    containers = docker_get("/containers/json?all=1", headers)
    cloudflared = next((c for c in containers if c["Names"][0].lstrip("/") == "cloudflared"), None)
    if not cloudflared:
        raise RuntimeError("cloudflared container not found")

    networks = docker_get("/networks", headers)
    target = next((n for n in networks if n.get("Name") == "comptabilitat_interna"), None)
    if not target:
        raise RuntimeError("comptabilitat_interna network not found")

    network_id = target["Id"]
    if any(n.get("Name") == "comptabilitat_interna" for n in cloudflared.get("NetworkSettings", {}).get("Networks", {}).values()):
        print("cloudflared already on comptabilitat_interna")
    else:
        docker_post(f"/networks/{network_id}/connect", headers, {"Container": cloudflared["Id"]})
        print("Connected cloudflared to comptabilitat_interna")

    web = next(
        (
            c
            for c in docker_get("/containers/json", headers)
            if c["Names"][0].lstrip("/").startswith("comptabilitat-web")
        ),
        None,
    )
    if web:
        web_name = web["Names"][0].lstrip("/")
        print(f"Cloudflare tunnel service URL: http://{web_name}:8080")


def main() -> int:
    headers = auth_headers()
    env = load_env()
    public_url = next(e["value"] for e in env if e["name"] == "PUBLIC_BASE_URL")

    stacks = request("GET", "/api/stacks", headers=headers)
    existing = next((s for s in stacks if s.get("Name") == STACK_NAME), None)

    body = {
        "RepositoryURL": REPO_URL,
        "RepositoryReferenceName": REPO_REF,
        "ComposeFilePathInRepository": COMPOSE_PATH,
        "RepositoryAuthentication": False,
        "Env": env,
    }

    if existing:
        stack_id = existing["Id"]
        request(
            "PUT",
            f"/api/stacks/{stack_id}/git/redeploy?endpointId={ENDPOINT_ID}",
            headers=headers,
            body=body,
        )
        print(f"Redeployed stack {STACK_NAME} (id {stack_id})")
    else:
        result = request(
            "POST",
            f"/api/stacks/create/standalone/repository?endpointId={ENDPOINT_ID}",
            headers=headers,
            body={"Name": STACK_NAME, **body},
        )
        print(f"Created stack {STACK_NAME} (id {result.get('Id', '?')})")

    print("Waiting for build and startup (this can take several minutes)...")
    wait_for_containers(headers)
    connect_cloudflared(headers)

    print("")
    print("=== Deployed ===")
    print(f"URL: {public_url}")
    print(f"Health: {public_url}/api/health")
    print(f"Enable Banking redirect: {public_url}/api/auth/callback")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        print(exc.read().decode(), file=sys.stderr)
        raise SystemExit(1)
