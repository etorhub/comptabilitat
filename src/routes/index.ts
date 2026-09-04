/**
 * Registre de rutes.
 *
 * Dos nivells, com tenia l'API de Python:
 *
 *   - transversals: entrada, contrasenya, usuaris, connexions, espais;
 *   - d'espai, sota `/e/:codi`, totes darrere del middleware que comprova
 *     l'acces.
 *
 * Els recursos es van afegint aqui a mesura que es migren. Mentre un no hi
 * sigui, la seva adreça dona un 404, que es el que toca.
 */

import { Hono } from "hono";

import { alertsRoutes } from "./alerts/alerts.routes.ts";
import { callbackRoute, connectionsRoutes } from "./connections/connections.routes.ts";
import { analyticsRoutes } from "./analytics/analytics.routes.ts";
import { authRoutes } from "./auth/auth.routes.ts";
import { categoriesRoutes } from "./categories/categories.routes.ts";
import { exportsRoutes } from "./exports/exports.routes.ts";
import { homeRoutes } from "./home/home.routes.ts";
import { merchantsRoutes } from "./merchants/merchants.routes.ts";
import { recurringRoutes } from "./recurring/recurring.routes.ts";
import { tagsRoutes } from "./tags/tags.routes.ts";
import { transactionsRoutes } from "./transactions/transactions.routes.ts";
import { usersRoutes } from "./users/users.routes.ts";
import { workspacesRoutes } from "./workspaces/workspaces.routes.ts";
import { requireAdmin, requireUser } from "../middleware/session.ts";
import { workspaceMiddleware } from "../middleware/workspace.ts";

export function registerRoutes(app: Hono): void {
  // --- Transversals --------------------------------------------------------
  app.route("/", authRoutes);
  app.route("/", homeRoutes);

  // El retorn del banc despres de l'autenticacio forta. **No va autenticat i
  // esta exempt de CSRF**: qui hi arriba ve del banc i no duu cap testimoni
  // nostre. El que el protegeix es l'`eb_auth_state` d'un sol us.
  app.route("/", callbackRoute);

  // --- Administracio de la instal·lacio ------------------------------------
  //
  // Gestionar bancs i usuaris no dona acces a cap espai: son coses separades.
  //
  // Compte amb el punt de muntatge: un `app.route("/", admin)` amb un
  // `use("*")` a dins **aplica la guarda a tota l'aplicacio**, no nomes a les
  // seves rutes, i deixaria fora del programa qui no fos administrador. La
  // guarda es penja del sub-programa i es munta ja sota `/usuaris`.
  const usuaris = new Hono();
  usuaris.use("*", requireUser);
  usuaris.use("*", requireAdmin);
  usuaris.route("/", usersRoutes);
  app.route("/usuaris", usuaris);

  const connexions = new Hono();
  connexions.use("*", requireUser);
  connexions.use("*", requireAdmin);
  connexions.route("/", connectionsRoutes);
  app.route("/connexions", connexions);

  // --- Dins d'un espai -----------------------------------------------------
  //
  // Tot el que penja d'aqui passa abans per `requireUser` i pel middleware
  // que resol l'espai i comprova l'acces. Cap ruta de dades no consulta la
  // taula `ledgers` pel seu compte.
  const espai = new Hono();
  espai.use("*", requireUser);
  espai.use("*", workspaceMiddleware);

  // Configuracio de l'espai: nomes administradors de la instal·lacio.
  // La guarda va a cada sub-programa, no a `espai` sencer: un `use("*")`
  // aqui tancaria Panell, Moviments i la resta.
  const ambAdmin = (rutes: Hono) => {
    const sub = new Hono();
    sub.use("*", requireAdmin);
    sub.route("/", rutes);
    return sub;
  };

  espai.route("/avisos", ambAdmin(alertsRoutes));
  espai.route("/categories", ambAdmin(categoriesRoutes));
  espai.route("/etiquetes", ambAdmin(tagsRoutes));
  espai.route("/comercos", ambAdmin(merchantsRoutes));
  espai.route("/configuracio", ambAdmin(workspacesRoutes));
  espai.route("/moviments", transactionsRoutes);
  espai.route("/recurrents", recurringRoutes);
  // Les descarregues pengen de Moviments i d'Informes, que son d'on surten.
  espai.route("/moviments", exportsRoutes);
  espai.route("/informes", exportsRoutes);

  // Les analitiques porten l'arrel de l'espai, els informes i la previsio.
  espai.route("/", analyticsRoutes);

  app.route("/e/:codi", espai);
}
