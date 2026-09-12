/**
 * Disposicio sense barra lateral: entrada i pagines d'error.
 *
 * No hi ha `hx-headers` amb el testimoni CSRF perque encara no hi ha sessio
 * de la qual derivar-lo. El formulari d'entrada duu el seu camp ocult; es
 * l'unic de tota l'aplicacio que ho fa.
 */

import { html } from "hono/html";
import { staticHref } from "../lib/estatics.ts";
import type { Html } from "../lib/html.ts";

export interface ShellProps {
  titol: string;
  children: unknown;
}

export function Shell(props: ShellProps): Html {
  return html`<!doctype html>
    <html lang="ca">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>${props.titol} · Comptabilitat</title>
        <link rel="icon" href="${staticHref("favicon.svg")}" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"
        />
        <link rel="stylesheet" href="${staticHref("app.css")}" />
        <script src="${staticHref("htmx.min.js")}" defer></script>
      </head>
      <body class="cos-centrat">
        <main class="targeta-centrada">${props.children}</main>
        <div id="toast" aria-live="polite"></div>
        <script>
          document.body.addEventListener("htmx:beforeSwap", function (e) {
            var codi = e.detail.xhr.status;
            if (codi >= 400 && codi < 500) {
              e.detail.shouldSwap = true;
              e.detail.isError = false;
            }
          });
        </script>
      </body>
    </html>` as Html;
}

/** Pagina de 404. La mateixa tant si no existeix com si no hi tens acces. */
export function NotFoundPage(): Html {
  return Shell({
    titol: "No s'ha trobat",
    children: html`
      <h1>No s'ha trobat</h1>
      <p class="text-suau">
        La pagina que busques no existeix, o no hi tens acces. Si creus que hi
        hauries de poder entrar, demana-ho a qui administri la instal·lacio.
      </p>
      <p><a class="boto" href="/">Torna a l'inici</a></p>
    `,
  });
}

export function ErrorPage(message: string): Html {
  return Shell({
    titol: "Error",
    children: html`
      <h1>Hi ha hagut un error</h1>
      <p class="text-suau">${message}</p>
      <p><a class="boto" href="/">Torna a l'inici</a></p>
    `,
  });
}
