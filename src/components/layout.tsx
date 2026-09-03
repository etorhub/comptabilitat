/**
 * Disposicio general.
 *
 * Aqui hi ha tres coses de les quals depen tota l'aplicacio:
 *
 *   1. El testimoni CSRF, publicat **un sol cop** com a `hx-headers` del
 *      `<body>`. Totes les peticions d'HTMX l'hereten. Cap formulari no en
 *      porta cap de propi.
 *   2. El `#toast`, l'unic lloc on surten els errors.
 *   3. El `htmx:beforeSwap` que deixa passar els 4xx. Sense aixo, HTMX
 *      descarta les respostes d'error i el `#toast` no arribaria mai.
 */

import { html, raw } from "hono/html";
import type { Html } from "../lib/html.ts";


import type { Ledger, LedgerRole, User } from "../db/schema/index.ts";
import { CSRF_HEADER } from "../lib/csrf.ts";

export interface LayoutProps {
  titol: string;
  user: User;
  csrfToken: string;
  /** Espais on l'usuari te acces, per al selector. */
  espais: (Ledger & { role: LedgerRole })[];
  /** Espai actiu, si la pagina n'esta dins. */
  espai?: Ledger | undefined;
  /** Comptadors de la barra lateral. Son objectius fora de banda. */
  perRevisar?: number;
  avisosNous?: number;
  children: unknown;
}

/**
 * El poc JavaScript que hi ha, i per que.
 *
 * - El `beforeSwap`: HTMX, per defecte, no intercanvia res quan la resposta
 *   es 4xx. Com que els errors arriben com un `#toast` fora de banda dins
 *   d'una resposta 4xx, cal deixar-los passar. Sense extensions.
 * - El `afterSwap`: torna a dibuixar els grafics que hagin entrat amb un
 *   fragment. Nomes fa alguna cosa si la pagina duu grafics.
 */
const SCRIPT_BASE = raw(`
document.body.addEventListener("htmx:beforeSwap", function (e) {
  var codi = e.detail.xhr.status;
  if (codi >= 400 && codi < 500) {
    // Deixa entrar el marcatge d'error (el #toast fora de banda i, si n'hi
    // ha, el formulari tornat a dibuixar amb els errors per camp).
    e.detail.shouldSwap = true;
    e.detail.isError = false;
  }
});
document.body.addEventListener("htmx:afterSwap", function () {
  if (window.Grafics) window.Grafics.dibuixaTots();
});
document.body.addEventListener("htmx:afterSettle", function () {
  if (window.Grafics) window.Grafics.dibuixaTots();
});
`);

export function Layout(props: LayoutProps): Html {
  const { titol, user, csrfToken, espais, espai, perRevisar = 0, avisosNous = 0 } = props;

  return html`<!doctype html>
    <html lang="ca">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${titol} · Comptabilitat</title>
        <link rel="icon" href="/favicon.svg" />
        <link rel="stylesheet" href="/app.css" />
        <script src="/htmx.min.js" defer></script>
        <!--
          Els grafics son una illa: ECharts i un fitxer que llegeix les dades
          que el servidor ha escrit a la pagina. Sense empaquetador i sense
          cap estat de client.
        -->
        <script src="/echarts.min.js" defer></script>
        <script src="/grafics.js" defer></script>
      </head>
      <!--
        El testimoni CSRF surt aqui i enlloc mes. Va lligat a la sessio, de
        manera que gira amb ella i mor amb ella.
      -->
      <body hx-headers='{"${raw(CSRF_HEADER)}": "${csrfToken}"}'>
        <a class="salta" href="#contingut">Ves al contingut</a>

        <div class="disposicio">
          ${Sidebar({ user, espais, espai, perRevisar, avisosNous })}

          <main id="contingut" class="principal">${props.children}</main>
        </div>

        <!-- L'unic lloc on surten els errors. Vegeu lib/http.ts. -->
        <div id="toast" aria-live="polite"></div>

        <script>
          ${SCRIPT_BASE}
        </script>
      </body>
    </html>` as Html;
}

interface SidebarProps {
  user: User;
  espais: (Ledger & { role: LedgerRole })[];
  espai?: Ledger | undefined;
  perRevisar: number;
  avisosNous: number;
}

function Sidebar({ user, espais, espai, perRevisar, avisosNous }: SidebarProps) {
  const codi = espai?.code;

  const enllacos: { href: string; text: string; comptador?: Html }[] = codi
    ? [
        { href: `/e/${codi}`, text: "Panell" },
        { href: `/e/${codi}/moviments`, text: "Moviments" },
        {
          // La cua de revisio es una vista dels moviments, i per aixo penja
          // d'ells. A l'aplicacio de React era `/e/:codi/revisio`.
          href: `/e/${codi}/moviments/revisio`,
          text: "Per revisar",
          comptador: ComptadorRevisio(perRevisar),
        },
        { href: `/e/${codi}/recurrents`, text: "Recurrents" },
        { href: `/e/${codi}/previsio`, text: "Previsio" },
        { href: `/e/${codi}/informes`, text: "Informes" },
        { href: `/e/${codi}/categories`, text: "Categories" },
        { href: `/e/${codi}/comercos`, text: "Comerços" },
        { href: `/e/${codi}/regles`, text: "Regles" },
        { href: `/e/${codi}/avisos`, text: "Avisos", comptador: ComptadorAvisos(avisosNous) },
        { href: `/e/${codi}/configuracio`, text: "Configuracio" },
      ]
    : [];

  return html`<nav class="barra" aria-label="Navegacio principal">
    <div class="barra-cap">
      <span class="marca">Comptabilitat</span>
    </div>

    ${espais.length > 0
      ? html`<label class="camp">
          <span class="camp-etiqueta">Espai</span>
          <select
            class="selector-espai"
            aria-label="Canvia d'espai"
            onchange="window.location.href = '/e/' + this.value"
          >
            ${espais.map(
              (e) =>
                html`<option value="${e.code}" ${e.code === codi ? raw("selected") : ""}>
                  ${e.name}
                </option>`,
            )}
          </select>
        </label>`
      : ""}

    <ul class="menu">
      ${enllacos.map(
        (enllac) => html`<li>
          <a href="${enllac.href}">
            <span>${enllac.text}</span>
            ${enllac.comptador ?? ""}
          </a>
        </li>`,
      )}
    </ul>

    ${user.isAdmin
      ? html`<div class="menu-seccio">
          <h2 class="menu-titol">Administracio</h2>
          <ul class="menu">
            <li><a href="/connexions">Connexions bancaries</a></li>
            <li><a href="/usuaris">Usuaris</a></li>
          </ul>
        </div>`
      : ""}

    <div class="barra-peu">
      <span class="usuari" title="${user.email}">${user.fullName || user.email}</span>
      <form method="post" action="/sortida">
        <button type="submit" class="boto boto-discret">Surt</button>
      </form>
    </div>
  </nav>`;
}

/**
 * Els dos comptadors de la barra lateral son **objectius fora de banda**.
 *
 * Substitueixen l'`invalidaEspai()` de l'aplicacio anterior, que després de
 * cada mutacio tornava a demanar-ho gairebe tot. Ara qui canvia el nombre el
 * torna, i prou. Vegeu `AGENTS.md`.
 */
export function ComptadorRevisio(n: number, oob = false) {
  return html`<span
    id="comptador-revisio"
    class="comptador ${n > 0 ? "comptador-actiu" : ""}"
    ${oob ? raw('hx-swap-oob="true"') : ""}
    >${n > 0 ? String(n) : ""}</span
  >`;
}

export function ComptadorAvisos(n: number, oob = false) {
  return html`<span
    id="comptador-avisos"
    class="comptador ${n > 0 ? "comptador-avis" : ""}"
    ${oob ? raw('hx-swap-oob="true"') : ""}
    >${n > 0 ? String(n) : ""}</span
  >`;
}
