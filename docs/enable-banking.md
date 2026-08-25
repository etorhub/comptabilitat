# Posada en marxa d'Enable Banking

Enable Banking és l'agregador PSD2 que connecta amb el Banco Santander. L'aplicació hi
parla amb un JWT signat amb RS256 amb la teva clau privada.

## 1. Aplicació i claus

Al [panell de control d'Enable Banking](https://enablebanking.com/cp):

1. Crea una aplicació. Tria **Personal use** i marca només **AIS** (informació de comptes):
   no necessitem iniciar pagaments i demanar-ho complicaria l'aprovació.
2. Puja o genera el parell de claus. Si les generes tu:

   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out eb_private_key.pem
   openssl rsa -in eb_private_key.pem -pubout -out eb_public_key.pem
   ```

   Puja només la **pública**. La privada no surt mai del NAS.
3. Apunta l'**Application ID**: és el `kid` del JWT.
4. Posa com a **redirect URL** exactament:

   ```
   https://EL-TEU-DOMINI/api/auth/callback
   ```

   Ha de coincidir caràcter per caràcter amb `PUBLIC_BASE_URL` + `/api/auth/callback`.

## 2. Del sandbox a producció restringida

Una aplicació nova neix en **sandbox**: connecta amb bancs simulats, no amb el Santander
real. Per veure dades de veritat cal demanar **producció restringida**, que és gratuïta i
permet connectar **només els teus propis comptes**, prèvia verificació.

Es demana des del mateix panell de control. **Demana-ho el primer dia**: hi ha temps
d'espera i, mentre no arribi, no es poden importar moviments reals. Amb el sandbox ja es
pot provar tot el flux (autorització, retorn, importació) contra un banc de mentida.

## 3. Configuració de l'aplicació

A `deploy/.env`:

```ini
EB_APPLICATION_ID=el-teu-application-id
EB_PRIVATE_KEY_PATH=/run/secrets/eb_private_key
EB_DEFAULT_ASPSP_NAME=Santander
EB_DEFAULT_ASPSP_COUNTRY=ES
EB_CONSENT_DAYS=90
EB_INITIAL_HISTORY_MONTHS=24
```

I la clau privada a `deploy/secrets/eb_private_key.pem`, que el `docker-compose.yml` munta
com a secret de només lectura. Aquest directori està ignorat pel git.

## 4. Connectar el banc

1. Entra a l'aplicació com a administrador i ves a **Connexions**.
2. **Connecta un banc** → et porta al Santander, hi fas l'autenticació forta (SCA) i
   tries quins comptes comparteixes.
3. En tornar, els comptes apareixen **sense llibre assignat**. Assigna cada compte al seu
   llibre (Personal, Calella, Pardals): fins llavors els seus moviments no compten enlloc.
4. Prem **Sincronitza**. La primera vegada baixa tot l'històric que doni el banc.

Si el Santander rebutja la finestra de 24 mesos, l'aplicació la va escurçant sola
(12, 6, 3 mesos, 90 dies) fins que n'accepta una; ho deixa escrit al registre.

## 5. El consentiment caduca cada 90 dies

És normativa PSD2 i no hi ha manera d'evitar-ho: cada 90 dies cal tornar a fer
l'autenticació al banc. L'aplicació avisa **7, 3 i 1 dia abans** amb un avís i un correu.

Per renovar-lo: **Connexions** → **Renova el consentiment** a la connexió que toqui. Es
conserven els comptes, el llibre que tinguessin assignat i tot l'històric importat.

Si el consentiment caduca abans d'hora, la sincronització ho detecta (`EXPIRED_SESSION`),
marca la connexió com a caducada i genera un avís urgent, en lloc de fallar en silenci.

## 6. Límits de crides

Sota PSD2 el Santander limita les consultes **sense l'usuari present** (habitualment 4 al
dia per compte). Per això:

- la sincronització automàtica és **una sola passada diària** (a les 6:30 per defecte);
- el botó **Sincronitza** de la interfície compta com a «usuari present», però convé no
  abusar-ne;
- cada intent queda registrat a `sync_runs`, amb quants moviments s'han inserit i
  actualitzat i quin error hi ha hagut, si n'hi ha.

## 7. Quan alguna cosa falla

| Símptoma | Què vol dir | Què fer |
|---|---|---|
| `No s'ha trobat la clau privada` | El secret no està muntat | Comprova `deploy/secrets/eb_private_key.pem` i torna a desplegar l'stack |
| `Falta EB_APPLICATION_ID` | Variable buida | Omple-la a `deploy/.env` |
| Retorn amb `estat=error` | El banc ha cancel·lat l'autorització | Torna a començar; si diu `access_denied`, és que s'ha denegat el permís al banc |
| `Estat d'autorització desconegut` | El `state` ja s'ha fet servir o ha caducat | Torna a prémer «Connecta un banc»: cada intent en genera un de nou |
| Consentiment caducat | Han passat els 90 dies | «Renova el consentiment» |
