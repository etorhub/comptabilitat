# Espais de treball

L'aplicació no és una comptabilitat amb tres seccions: són **tres comptabilitats
separades** que comparteixen instal·lació. Cada espai té els seus comptes, el seu pla de
categories, els seus comerços, les seves regles, els seus avisos i els seus usuaris.

No hi ha cap pantalla que en barregi més d'un. A la barra lateral hi ha un selector: el
que veus a sota és sempre d'un sol espai, i la seva adreça ho reflecteix
(`/e/personal/moviments`, `/e/calella/informes`).

## Qui hi entra

L'accés es dona espai per espai, amb tres nivells:

| Rol | Què pot fer |
|---|---|
| `viewer` | Mirar-ho tot de l'espai: moviments, informes, previsió |
| `editor` | A més, classificar moviments, anotar-los i crear regles |
| `admin` | A més, configurar l'espai: destinataris d'avisos, llindar de descobert i comptes |

**Ser administrador de l'aplicació no dona accés a cap espai.** Qui gestiona les connexions
bancàries i els usuaris no veu, per defecte, la comptabilitat de ningú: l'accés s'ha de
concedir explícitament. Això vol dir que tu, encara que administris la instal·lació,
necessites accés a Personal, Calella i Pardals com qualsevol altre.

Qui no té accés a un espai rep un **404**, no un 403: no ha de saber ni que existeix.

```bash
docker compose exec app bun run cli dona-acces \
  --email sogra@example.com --espai calella --rol viewer
```

## Què no es comparteix

| | Compartit | De cada espai |
|---|---|---|
| Usuaris i sessions | ✓ | |
| Connexions bancàries | ✓ | |
| Comptes | | ✓ (assignats a un espai) |
| Moviments | | ✓ |
| Categories | | ✓ |
| Comerços | | ✓ |
| Regles | | ✓ |
| Recurrents i previsions | | ✓ |
| Avisos i destinataris | | ✓ |

Que els comerços no es comparteixin té un cost i un motiu. El cost: el mateix Mercadona
s'ha de classificar un cop a cada espai on aparegui. El motiu: si es compartissin, la
sogra confirmant una categoria a Calella canviaria com es classifica el mateix comerç al
teu Personal, i el nom d'un comerç sovint és el nom d'una persona (transferències, Bizum).

## Diners que passen d'un espai a l'altre

Si mous 400 € de Personal a Calella, es veuen **dues vegades i per separat**: com una
sortida de 400 € a Personal i com una entrada de 400 € a Calella. No s'aparellen ni
desapareixen dels informes.

És el que toca amb comptabilitats separades: per a qui mira Calella, aquells diners han
entrat de debò, i d'on venen no és cosa seva.

Els traspassos **sí** que s'aparellen quan són entre dos comptes **del mateix espai**: si
Personal té dos comptes i mous diners d'un a l'altre, això no és ni ingrés ni despesa i
queda fora dels informes.

## Moure un compte d'espai

Es fa des de **Connexions bancàries** (cal ser administrador de l'aplicació). Arrossega
tot l'historial del compte a l'espai nou.

Compte: com que les categories, els comerços i les regles són de cada espai, les
classificacions anteriors deixen de ser vàlides. L'aplicació les neteja, torna a crear els
comerços dins de l'espai nou i hi aplica les seves regles; el que no encaixi queda a la
safata de revisió. **No és una operació per fer sovint.**

## Avisos

Cada espai té la seva llista de destinataris, a **Configuració → Espai**. L'avís d'un
descobert previst a Calella va a qui hi hagis posat; el de Personal, a qui hi hagis posat
allà. Si un espai deixa la llista buida, els seus avisos van als destinataris generals de
`ALERT_RECIPIENTS`.

Els avisos que no són de cap espai (una sincronització fallida, un consentiment caducat)
van sempre als destinataris generals.

## Crear-ne un de nou

Des de la línia d'ordres. No hi ha pantalla per fer-ho: crear un espai és una cosa
d'una vegada, i una pantalla que es fa servir un cop és una pantalla de més.

```bash
docker compose exec app bun run cli crea-espai \
  --codi nou --nom "Nom de l'espai" --color "#7c3aed"
```

Es crea amb el seu pla de categories sencer, però **sense ningú a dins**: l'accés es dona
a part, amb `dona-acces`. Després només cal assignar-hi un compte des de Connexions. El
llindar de descobert i els destinataris dels avisos es configuren des de la pantalla de
**Configuració** de l'espai.
