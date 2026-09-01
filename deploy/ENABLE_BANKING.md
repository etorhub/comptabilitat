# Enable Banking — claus generades per al desplegament

Les claus RSA s'han generat a `deploy/secrets/`. **Puja només la clau pública**
al panell d'Enable Banking; la privada no surt mai del NAS.

## Clau pública (per pujar al panell)

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTNOTLFrjMKOBMpMONTg
vjCwotNJtDahGJGwRIheI0S10xxVGsb/3TInc9tg/jL9BD3cpgWuwxOm55gG98KC
ZF9y+nhhYvnn5oTIlB4+qE1W05+kMOOgm8riz/T1zr1+lRcdorhlEKwnDfr9VBoy
qYvLiLHhQRh2wIicXky+x8uIx9MXe9oIfxdIFi8Ea706yepMT/H/ius2zKx1Mtug
a8lRD8EBxehhsFeKlflPz/siVNubIzvr1HsEgnR60WDdfgxsrlPSVeCcMMhP8ckR
xxcv7nqfs9bzYYOfg1Nv3JkQzTQNkRSbE7goarSvlaWh2hVngd2eTKrOsDcuXMxM
mQIDAQAB
-----END PUBLIC KEY-----
```

Fitxer: `deploy/secrets/eb_public_key.pem`

## Passos al panell

1. Entra a [enablebanking.com/cp](https://enablebanking.com/cp)
2. **Create application** → **Personal use** → només **AIS**
3. Puja `eb_public_key.pem` o enganxa la clau de dalt
4. Apunta l'**Application ID** → posa'l a `EB_APPLICATION_ID` a `deploy/.env`
5. **Redirect URL** (exactament):

   ```
   https://comptabilitat.dossierapp.org/api/auth/callback
   ```

   Canvia el domini si el teu hostname de Cloudflare és diferent.

6. **Demana producció restringida** el primer dia (gratuïta, només els teus comptes)

## Comprovació

Després d'omplir `EB_APPLICATION_ID` i tornar a desplegar:

```bash
docker compose exec api python -c "
from app.integrations.enablebanking.client import EnableBankingClient
with EnableBankingClient() as c:
    print(c.get_application())
"
```

Si retorna dades de l'aplicació, les credencials són correctes.
