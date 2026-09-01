# Desplegament via Portainer (UGREEN NAS)

Guia pas a pas per desplegar l'stack al NAS sense SSH. El repositori ja inclou
`deploy/docker-compose.yml` amb el perfil `tunnel` opcional per reutilitzar el teu
`cloudflared` existent.

## 1. Cloudflare (abans de Enable Banking)

Al túnel existent, afegeix un **Public Hostname**:

| Camp | Valor |
|---|---|
| Subdomain | `comptes` |
| Domain | el teu domini |
| Service | `http://web:8080` *(després del pas 5, actualitza amb el nom real del contenidor)* |

`PUBLIC_BASE_URL` ha de ser `https://comptes.el-teu-domini` (sense barra final).

## 2. Enable Banking

Segueix [`deploy/ENABLE_BANKING.md`](../deploy/ENABLE_BANKING.md): puja la clau
pública, configura el redirect URL i demana producció restringida.

## 3. Fitxers al NAS

Al directori del projecte al NAS (per exemple `~/code/comptabilitat`):

```bash
cp deploy/.env.example deploy/.env
# Omple POSTGRES_PASSWORD, SECRET_KEY, PUBLIC_BASE_URL, EB_APPLICATION_ID
cp eb_private_key.pem deploy/secrets/eb_private_key.pem
chmod 600 deploy/secrets/eb_private_key.pem
```

Genera secrets:

```bash
openssl rand -hex 32          # SECRET_KEY
openssl rand -base64 24       # POSTGRES_PASSWORD
```

**Important:** no deixis `ALERT_RECIPIENTS=` buit; omet la variable si no fas servir correu.

## 4. Stack a Portainer

**Stacks → Add stack** → nom `comptabilitat`

| Camp | Valor |
|---|---|
| Build method | Repository |
| Repository URL | `https://github.com/etorhub/comptabilitat` |
| Compose path | `deploy/docker-compose.yml` |
| Environment variables | Contingut de `deploy/.env` |

Portainer clona el repositori i fa `docker compose build` al NAS. La primera
vegada pot trigar uns minuts (frontend + backend).

**No activis el perfil `tunnel`** si reutilitzes el cloudflared existent.

## 5. Connectar cloudflared

Després que tots els contenidors estiguin `healthy`:

```bash
cd ~/code/comptabilitat/deploy
bash scripts/connect-tunnel.sh
```

Actualitza el Service URL del hostname de Cloudflare amb el que indica l'script.

## 6. Primer usuari

```bash
bash scripts/setup-admin.sh etorius@gmail.com "El teu nom"
```

La contrasenya es genera automàticament si no en passes una de tercer argument.

## 7. Connectar Santander

1. Entra a `https://comptes.el-teu-domini`
2. **Connexions** → **Connecta un banc**
3. Assigna cada compte al seu espai
4. **Sincronitza**

## Actualitzacions

Per actualitzar després d'un `git push`:

**Stacks → comptabilitat → Pull and redeploy**

O amb SSH:

```bash
bash deploy/scripts/nas-deploy.sh --build
```

## Comprovacions

```bash
docker compose ps
curl -s https://comptes.el-teu-domini/api/health
docker compose logs worker | head -20
```
