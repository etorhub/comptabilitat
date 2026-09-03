/**
 * Disposicio sense barra lateral: entrada i pagines d'error.
 *
 * No hi ha `hx-headers` amb el testimoni CSRF perque encara no hi ha sessio
 * de la qual derivar-lo. El formulari d'entrada duu el seu camp ocult; es
 * l'unic de tota l'aplicacio que ho fa.
 */

import { html } from "hono/html";
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
        <meta name="color-scheme" content="light dark" />
        <title>${props.titol} · Comptabilitat</title>
        <link rel="icon" href="/favicon.svg" />
        <link rel="stylesheet" href="/app.css" />
        <script src="/htmx.min.js" defer></script>
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

export function ErrorPage(missatge: string): Html {
  return Shell({
    titol: "Error",
    children: html`
      <h1>Hi ha hagut un error</h1>
      <p class="text-suau">${missatge}</p>
      <p><a class="boto" href="/">Torna a l'inici</a></p>
    `,
  });
}
