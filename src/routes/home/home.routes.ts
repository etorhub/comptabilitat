/**
 * Arrel i pagina de «no tens cap espai».
 *
 * L'arrel no ensenya res: porta al primer espai on tinguis acces. Aixo
 * substitueix les dues redireccions de client que feia l'aplicacio anterior,
 * que passaven per `localStorage` i per una adreça inventada (`/e/-`).
 */

import { Hono } from "hono";
import { html } from "hono/html";

import { Layout } from "../../components/layout.tsx";
import { page } from "../../lib/http.ts";
import { currentUser, requireUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";

export const homeRoutes = new Hono();

homeRoutes.get("/", requireUser, async (c) => {
  const user = currentUser(c);
  const espais = await myWorkspaces(user.id);
  const primer = espais[0];
  return c.redirect(primer ? `/e/${primer.code}` : "/sense-espais", 303);
});

homeRoutes.get("/sense-espais", requireUser, async (c) => {
  const user = currentUser(c);
  return page(
    c,
    Layout({
      titol: "Sense espais",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      espais: [],
      children: html`
        <header class="capçalera"><h1>Encara no tens cap espai</h1></header>
        <p class="text-suau">
          Els espais es concedeixen un per un. Ser administrador de la
          instal·lacio no en dona cap:
          ${
            user.isAdmin
              ? html`pots crear-ne un o donar-te acces des de
              <a href="/usuaris">Usuaris</a>.`
              : html`demana-ho a qui administri la instal·lacio.`
          }
        </p>
      `,
    }),
  );
});
