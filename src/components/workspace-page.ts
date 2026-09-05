/**
 * Munta una pagina de dins d'un espai.
 *
 * Totes les pagines d'espai passen per aqui, de manera que la barra lateral,
 * el selector d'espais i els dos comptadors surten sempre igual i ningu no se
 * n'ha de recordar.
 */

import type { Context } from "hono";

import { Layout } from "./layout.tsx";
import type { Html } from "../lib/html.ts";
import { comptadors } from "../services/comptadors.ts";
import { currentUser } from "../middleware/session.ts";
import { currentWorkspace, myWorkspaces } from "../middleware/workspace.ts";

export async function workspacePage(
  c: Context,
  titol: string,
  children: unknown,
): Promise<Html> {
  const user = currentUser(c);
  const espai = currentWorkspace(c);

  const [espais, { perRevisar, avisosNous }] = await Promise.all([
    myWorkspaces(user.id),
    comptadors(espai.id),
  ]);

  return Layout({
    titol,
    user,
    csrfToken: c.get("csrfToken") ?? "",
    ruta: c.req.path,
    espais,
    espai,
    perRevisar,
    avisosNous,
    children,
  });
}
