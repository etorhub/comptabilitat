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
import { analyticsRoutes } from "./analytics/analytics.routes.ts";
import { authRoutes } from "./auth/auth.routes.ts";
import { categoriesRoutes } from "./categories/categories.routes.ts";
import { exportsRoutes } from "./exports/exports.routes.ts";
import { homeRoutes } from "./home/home.routes.ts";
import { merchantsRoutes } from "./merchants/merchants.routes.ts";
import { recurringRoutes } from "./recurring/recurring.routes.ts";
import { rulesRoutes } from "./rules/rules.routes.ts";
import { transactionsRoutes } from "./transactions/transactions.routes.ts";
import { requireUser } from "../middleware/session.ts";
import { workspaceMiddleware } from "../middleware/workspace.ts";

export function registerRoutes(app: Hono): void {
  // --- Transversals --------------------------------------------------------
  app.route("/", authRoutes);
  app.route("/", homeRoutes);

  // --- Dins d'un espai -----------------------------------------------------
  //
  // Tot el que penja d'aqui passa abans per `requireUser` i pel middleware
  // que resol l'espai i comprova l'acces. Cap ruta de dades no consulta la
  // taula `ledgers` pel seu compte.
  const espai = new Hono();
  espai.use("*", requireUser);
  espai.use("*", workspaceMiddleware);

  espai.route("/avisos", alertsRoutes);
  espai.route("/categories", categoriesRoutes);
  espai.route("/comercos", merchantsRoutes);
  espai.route("/regles", rulesRoutes);
  espai.route("/moviments", transactionsRoutes);
  espai.route("/recurrents", recurringRoutes);
  // Les descarregues pengen de Moviments i d'Informes, que son d'on surten.
  espai.route("/moviments", exportsRoutes);
  espai.route("/informes", exportsRoutes);

  // Les analitiques porten l'arrel de l'espai, els informes i la previsio.
  espai.route("/", analyticsRoutes);

  app.route("/e/:codi", espai);
}
