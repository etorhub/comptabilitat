# Operació del dia a dia

## Què passa sol i quan

| Hora | Feina | Què fa |
|---|---|---|
| 03:15 | Model local | Proposa categoria per als comerços nous (només si Ollama està actiu) |
| 04:45 | Anàlisi | Recalcula recurrents, previsions i avisos de descobert |
| 06:30 | Sincronització | Baixa els moviments del banc, els classifica, aparella traspassos i torna a analitzar |
| 08:00 | Resum d'avisos | Un correu amb tots els avisos nous |
| cada hora | Avisos urgents | Correu immediat per als crítics (descobert imminent, consentiment caducat) |

Els horaris es canvien amb `SYNC_CRON_HOUR`, `CLASSIFY_CRON_HOUR`, `ANALYSIS_CRON_HOUR` i
`NOTIFY_CRON_HOUR` a `deploy/.env`.

Per llançar-les a mà:

```bash
docker compose exec worker python -m app.cli sync        # sincronitza ara
docker compose exec worker python -m app.cli classify    # torna a classificar
docker compose exec worker python -m app.cli analyze     # recurrents i previsions
docker compose exec worker python -m app.cli notify      # envia els avisos pendents
```

## Com es classifiquen els moviments

L'ordre és sempre el mateix, del més barat i explícit al més car:

1. **El que has decidit tu.** Mai es toca.
2. **Regles**, per prioritat (número més baix, abans).
3. **Memòria de comerços**: si el comerç ja es va resoldre abans, s'aplica igual.
4. **Model local**, només per als comerços que no han encaixat enlloc.
5. La resta va a **Per revisar**.

Quan corregeixes la categoria d'un moviment, per defecte la decisió es recorda per a **tot
el comerç** i es propaga als moviments passats que no haguessis tocat tu. Si a més marques
«crea una regla», queda una regla apresa visible a **Configuració → Regles**.

El model local mai confirma res pel seu compte: quan proposa una categoria, el moviment
queda marcat per revisar amb la seva confiança i la seva justificació.

## Traspassos entre comptes propis

Quan surten diners d'un compte i n'entren els mateixos a un altre dins de tres dies,
s'aparellen automàticament i deixen de comptar com a ingrés i com a despesa. Sense això,
moure diners de Personal a Calella inflaria les dues columnes de la vista consolidada.

Es veuen a **Moviments** marcant «Inclou traspassos».

## Avisos

| Avís | Quan salta |
|---|---|
| Possible descobert | La projecció d'un llibre baixa del seu llindar dins l'horitzó |
| Consentiment a punt de caducar | 7, 3 i 1 dia abans |
| Consentiment caducat | El banc rebutja la sessió |
| Canvi d'import d'un rebut | L'últim rebut s'aparta més d'un 10% del que és habitual |
| Rebut que no ha arribat | Han passat 7 dies de la data prevista |
| Sincronització fallida | L'intent del dia ha fallat |

Cap avís es repeteix: la clau de deduplicació inclou el període. Si en descartes un, no
torna.

El llindar de descobert de cada llibre és `overdraft_threshold` i per defecte és zero. Si
un compte té una línia de crèdit, posa-hi el número negatiu que correspongui.

## Còpies de seguretat

El servei `backup` fa un `pg_dump` comprimit diari a `deploy/backups/` i esborra els de
més de `BACKUP_RETENTION_DAYS` dies (30 per defecte).

**Això no és opcional.** Un cop passa la finestra que ofereix el banc (12-24 mesos), la
base de dades és l'única còpia que queda de l'històric. Convé que `deploy/backups/` estigui
dins d'un volum del NAS que ja tinguis replicat fora de casa.

Comprovar que la còpia serveix (val la pena fer-ho un cop):

```bash
ls -lh deploy/backups/
gunzip -c deploy/backups/comptabilitat-XXXXXXXX-XXXXXX.sql.gz | head -20
```

Restaurar:

```bash
docker compose stop api worker
gunzip -c deploy/backups/comptabilitat-XXXXXXXX-XXXXXX.sql.gz \
  | docker compose exec -T db psql -U comptabilitat -d comptabilitat
docker compose start api worker
```

## Actualitzar

```bash
git pull
docker compose up -d --build
```

L'`api` aplica les migracions pendents en arrencar, abans d'acceptar cap petició. El
`worker` espera que l'`api` estigui sana, de manera que les migracions no s'executen dues
vegades alhora.

## Mirar què passa

```bash
docker compose logs -f api worker
docker compose exec db psql -U comptabilitat -d comptabilitat \
  -c "select started_at, status, transactions_inserted, error from sync_runs order by started_at desc limit 10;"
```

## Seguretat

- Les contrasenyes es desen amb argon2 i les sessions són galetes `httpOnly` + `Secure` +
  `SameSite=Lax`; a la base de dades només hi ha el resum del testimoni.
- Cada consulta es filtra pels llibres permesos de l'usuari, mai per un identificador que
  vingui del client.
- La clau privada d'Enable Banking es munta com a secret de només lectura i no és mai al
  repositori.
- Canviar la contrasenya tanca la resta de sessions obertes.
