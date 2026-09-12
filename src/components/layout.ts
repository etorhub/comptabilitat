/**
 * The overall layout.
 *
 * Three things the whole application depends on live here:
 *
 *   1. The CSRF token, published **once** as the `<body>`'s `hx-headers`.
 *      Every htmx request inherits it. No form carries one of its own.
 *   2. The `#toast`, the only place errors appear.
 *   3. The `htmx:beforeSwap` that lets 4xx responses through. Without it htmx
 *      discards error responses and the `#toast` would never arrive.
 */

import { html, raw } from "hono/html";
import type { Html } from "../lib/html.ts";

import type { Ledger, LedgerRole, User } from "../db/schema/index.ts";
import { CSRF_HEADER } from "../lib/csrf.ts";
import { staticHref } from "../lib/estatics.ts";
import { oobAttributes } from "../lib/oob.ts";

export interface LayoutProps {
  title: string;
  user: User;
  csrfToken: string;
  /** The workspaces the user can reach, for the picker. */
  workspaces: (Ledger & { role: LedgerRole })[];
  /** The active workspace, when the page is inside one. */
  workspace?: Ledger | undefined;
  /**
   * The URL being viewed (`c.req.path`), so it can be marked in the menu.
   *
   * The stylesheet already gave `.menu a[aria-current="page"]` a background
   * and no template ever wrote it: the sidebar did not say where you were,
   * neither by colour nor to a screen reader.
   */
  ruta?: string;
  /** The sidebar counters. They are out-of-band targets. */
  perRevisar?: number;
  newAlerts?: number;
  children: unknown;
}

/**
 * The little JavaScript there is, and why.
 *
 * - `beforeSwap`: by default htmx swaps nothing when the response is 4xx.
 *   Since errors arrive as an out-of-band `#toast` inside a 4xx, they have to
 *   be let through. No extensions.
 * - `afterSwap`: redraws any charts that came in with a fragment. It does
 *   nothing unless the page has charts.
 */
const SCRIPT_BASE = raw(`
document.body.addEventListener("htmx:beforeSwap", function (e) {
  var codi = e.detail.xhr.status;
  if (codi >= 400 && codi < 500) {
    // Let the error markup in (the out-of-band #toast and, when there is one,
    // the form re-rendered with its per-field errors).
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

/**
 * The drawer's two icons.
 *
 * Drawn here rather than loaded from a file: they are two strokes, and they do
 * not justify another request on every page load. `aria-hidden`, because
 * whoever needs to understand them does so through the `aria-label` of the
 * `<label>` that contains them.
 */
const iconMenu = raw(
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
);

const closeIcon = raw(
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
);

export function Layout(props: LayoutProps): Html {
  const {
    title,
    user,
    csrfToken,
    workspaces,
    workspace,
    perRevisar = 0,
    newAlerts = 0,
    ruta = "",
  } = props;

  return html`<!doctype html>
    <html lang="ca">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <!--
          There is only one palette (paper and ink), like a printed sheet: no
          toggle and no dark variant. See styles/app.css.
        -->
        <meta name="color-scheme" content="light" />
        <title>${title} · Comptabilitat</title>
        <link rel="icon" href="${staticHref("favicon.svg")}" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"
        />
        <link rel="stylesheet" href="${staticHref("app.css")}" />
        <script src="${staticHref("htmx.min.js")}" defer></script>
        <!--
          The charts are an island: ECharts plus one file that reads the data
          the server wrote into the page. No bundler and no client state.
        -->
        <script src="${staticHref("echarts.min.js")}" defer></script>
        <script src="${staticHref("grafics.js")}" defer></script>
      </head>
      <!--
        The CSRF token appears here and nowhere else. It is tied to the
        session, so it rotates with it and dies with it.
      -->
      <body hx-headers='{"${raw(CSRF_HEADER)}": "${csrfToken}"}'>
        <a class="salta" href="#contingut">Ves al contingut</a>

        <!--
          The navigation drawer, with no JavaScript at all: a hidden checkbox
          and a few labels. Same idiom as the collapsible search on the
          transactions page (the toggle-cerca class).

          Since every link is a full page load, the checkbox resets itself on
          navigation and the drawer closes on its own.
        -->
        <input type="checkbox" id="menu-obert" class="toggle-menu visualment-ocult" />

        <header class="barra-mobil">
          <label for="menu-obert" class="boto-menu" aria-label="Obre el menu">
            ${iconMenu}
          </label>
          <span class="marca">Comptabilitat</span>
          ${workspace ? html`<span class="barra-mobil-espai text-suau">${workspace.name}</span>` : ""}
        </header>

        <div class="disposicio">
          <!-- Tapping outside the drawer closes it. For sighted users only. -->
          <label for="menu-obert" class="rerefons-menu" aria-hidden="true"></label>

          ${Sidebar({ user, workspaces, workspace, perRevisar, newAlerts, ruta })}

          <main id="contingut" class="principal">${props.children}</main>
        </div>

        <!-- The only place errors appear. See lib/http.ts. -->
        <div id="toast" aria-live="polite"></div>

        <script>
          ${SCRIPT_BASE}
        </script>
      </body>
    </html>` as Html;
}

interface SidebarProps {
  user: User;
  workspaces: (Ledger & { role: LedgerRole })[];
  workspace?: Ledger | undefined;
  perRevisar: number;
  newAlerts: number;
  ruta: string;
}

/**
 * Which menu link is the current page.
 *
 * The **longest** match wins, not the first: `/e/x` is the start of all the
 * others, and `/e/x/moviments` is the start of `/e/x/moviments/revisio`. With
 * first-match, "Panell" would be marked everywhere.
 */
function activeLink(rutes: string[], ruta: string): string | undefined {
  const paths = rutes.filter((href) => ruta === href || ruta.startsWith(`${href}/`));
  return paths.toSorted((a, b) => b.length - a.length)[0];
}

function Sidebar({ user, workspaces, workspace, perRevisar, newAlerts, ruta }: SidebarProps) {
  const code = workspace?.code;

  const links: { href: string; text: string; comptador?: Html }[] = code
    ? [
        { href: `/e/${code}`, text: "Panell" },
        { href: `/e/${code}/moviments`, text: "Moviments" },
        {
          // The review queue is a view of the transactions, which is why it
          // hangs off them. In the React app it was `/e/:codi/revisio`.
          href: `/e/${code}/moviments/revisio`,
          text: "Per revisar",
          comptador: ReviewCounter(perRevisar),
        },
        { href: `/e/${code}/recurrents`, text: "Recurrents" },
        { href: `/e/${code}/previsio`, text: "Previsio" },
        { href: `/e/${code}/informes`, text: "Informes" },
      ]
    : [];

  const configuracio: { href: string; text: string; comptador?: Html }[] = code
    ? [
        { href: `/e/${code}/configuracio`, text: "Espai" },
        { href: `/e/${code}/categories`, text: "Categories" },
        { href: `/e/${code}/etiquetes`, text: "Etiquetes" },
        { href: `/e/${code}/avisos`, text: "Avisos", comptador: AlertCounter(newAlerts) },
      ]
    : [];

  const active = activeLink(
    [
      ...links.map((e) => e.href),
      ...configuracio.map((e) => e.href),
      ...(user.isAdmin ? ["/connexions", "/feines", "/usuaris"] : []),
    ],
    ruta,
  );
  // The space goes inside: without it, every link that is not the current one
  // would end up as `<a href="…" >`.
  const marca = (href: string) => (href === active ? raw(' aria-current="page"') : "");

  return html`<nav class="barra" aria-label="Navegacio principal">
    <div class="barra-cap">
      <span class="marca">Comptabilitat</span>
      <!-- Only visible when the sidebar is a drawer, i.e. on a phone. -->
      <label for="menu-obert" class="tanca-menu" aria-label="Tanca el menu">${closeIcon}</label>
    </div>

    ${
      workspaces.length > 0
        ? html`<label class="camp">
          <span class="camp-etiqueta">Espai</span>
          <select
            class="selector-espai"
            aria-label="Canvia d'espai"
            onchange="window.location.href = '/e/' + this.value"
          >
            ${workspaces.map(
              (e) =>
                html`<option value="${e.code}" ${e.code === code ? raw("selected") : ""}>
                  ${e.name}
                </option>`,
            )}
          </select>
        </label>`
        : ""
    }

    <ul class="menu">
      ${links.map(
        (link) => html`<li>
          <a href="${link.href}"${marca(link.href)}>
            <span>${link.text}</span>
            ${link.comptador ?? ""}
          </a>
        </li>`,
      )}
    </ul>

    ${
      user.isAdmin && code
        ? html`<div class="menu-seccio">
          <h2 class="menu-titol">Configuracio</h2>
          <ul class="menu">
            ${configuracio.map(
              (link) => html`<li>
                <a href="${link.href}"${marca(link.href)}>
                  <span>${link.text}</span>
                  ${link.comptador ?? ""}
                </a>
              </li>`,
            )}
          </ul>
        </div>`
        : ""
    }

    ${
      user.isAdmin
        ? html`<div class="menu-seccio">
          <h2 class="menu-titol">Administracio</h2>
          <ul class="menu">
            <li>
              <a href="/connexions"${marca("/connexions")}>Connexions bancaries</a>
            </li>
            <li><a href="/feines"${marca("/feines")}>Feines</a></li>
            <li><a href="/usuaris"${marca("/usuaris")}>Usuaris</a></li>
          </ul>
        </div>`
        : ""
    }

    <div class="barra-peu">
      <span class="usuari" title="${user.email}">${user.fullName || user.email}</span>
      <form method="post" action="/sortida">
        <button type="submit" class="boto boto-discret">Surt</button>
      </form>
    </div>
  </nav>`;
}

/**
 * The sidebar's two counters are **out-of-band targets**.
 *
 * They replace the previous application's `invalidaEspai()`, which re-fetched
 * almost everything after every mutation. Now whoever changes the number
 * returns it, and that is all. See `AGENTS.md`.
 */
export function ReviewCounter(n: number, oob = false) {
  return html`<span
    ${oobAttributes("comptador-revisio", oob)}
    class="comptador ${n > 0 ? "comptador-actiu" : ""}"
    >${n > 0 ? String(n) : ""}</span
  >`;
}

export function AlertCounter(n: number, oob = false) {
  return html`<span
    ${oobAttributes("comptador-avisos", oob)}
    class="comptador ${n > 0 ? "comptador-avis" : ""}"
    >${n > 0 ? String(n) : ""}</span
  >`;
}
