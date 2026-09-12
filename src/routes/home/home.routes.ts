/**
 * Root and the «you have no workspace» page.
 *
 * The root shows nothing: it takes you to the first workspace you can access.
 * This replaces the two client-side redirects the previous application did,
 * which went through `localStorage` and through a made-up URL (`/e/-`).
 */

import { Hono } from "hono";
import { html } from "hono/html";

import { Layout } from "../../components/layout.ts";
import { page } from "../../lib/http.ts";
import { currentUser, requireUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";

export const homeRoutes = new Hono();

homeRoutes.get("/", requireUser, async (c) => {
  const user = currentUser(c);
  const workspaces = await myWorkspaces(user.id);
  const first = workspaces[0];
  return c.redirect(first ? `/e/${first.code}` : "/sense-espais", 303);
});

homeRoutes.get("/sense-espais", requireUser, async (c) => {
  const user = currentUser(c);
  return page(
    c,
    Layout({
      title: "Sense espais",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      workspaces: [],
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
