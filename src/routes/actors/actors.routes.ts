/**
 * Rutes dels actors.
 */

import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { fragment, idDeLaRuta, page, pushUrl, toastOnly } from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  confirmaActor,
  fusionaActors,
  llistaActors,
  lligaUsuari,
  totsElsActors,
  usuarisPerLligar,
  vistaActor,
} from "../../services/actors.ts";
import { Fila, Taula } from "./actors.fragment.tsx";
import { ActorsPage } from "./actors.page.tsx";
import {
  actorConfirmSchema,
  actorFiltersSchema,
  actorFiltersToQuery,
  actorMergeSchema,
  actorUserSchema,
  PER_PAGINA,
} from "./actors.schema.ts";

export const actorsRoutes = new Hono();

async function dades(ledgerId: number, query: Record<string, string>) {
  const filters = actorFiltersSchema.parse(query);
  const [pagina, usuaris, tots] = await Promise.all([
    llistaActors(ledgerId, {
      cerca: filters.cerca,
      nomesSenseConfirmar: filters.sense_confirmar,
      limit: PER_PAGINA,
      offset: filters.pagina * PER_PAGINA,
    }),
    usuarisPerLligar(),
    totsElsActors(ledgerId),
  ]);
  return { filters, pagina, usuaris, tots };
}

/** Una fila sola, amb tot el que li cal per dibuixar el selector de fusio. */
async function filaDe(id: number, ledgerId: number, codi: string, potEditar: boolean) {
  const [actor, usuaris, tots] = await Promise.all([
    vistaActor(id, ledgerId),
    usuarisPerLligar(),
    totsElsActors(ledgerId),
  ]);
  return Fila({
    codi,
    actor,
    usuaris,
    altres: tots.filter((a) => a.id !== id),
    potEditar,
  });
}

// --- Pagina ----------------------------------------------------------------

actorsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, usuaris, tots } = await dades(espai.id, c.req.query());

  return page(
    c,
    await workspacePage(
      c,
      "Actors",
      ActorsPage({
        codi: espai.code,
        pagina,
        usuaris,
        tots,
        filters,
        potEditar: roleAtLeast(currentRole(c), "editor"),
      }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

actorsRoutes.get("/fragment/taula", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, usuaris, tots } = await dades(espai.id, c.req.query());

  pushUrl(c, `/e/${espai.code}/actors${actorFiltersToQuery(filters)}`);

  return fragment(
    c,
    Taula({
      codi: espai.code,
      pagina,
      usuaris,
      tots,
      filters,
      potEditar: roleAtLeast(currentRole(c), "editor"),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

actorsRoutes.post("/:id/confirma", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest actor no existeix");
  const parsed = actorConfirmSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "El nom o la mena no son valids", 422);
  }

  await confirmaActor(id, espai.id, {
    kind: parsed.data.kind,
    displayName: parsed.data.display_name,
  });

  return fragment(c, await filaDe(id, espai.id, espai.code, true));
});

actorsRoutes.post("/:id/usuari", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest actor no existeix");
  const parsed = actorUserSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "L'usuari no es valid", 422);
  }

  await lligaUsuari(id, espai.id, parsed.data.user_id);

  return fragment(c, await filaDe(id, espai.id, espai.code, true));
});

actorsRoutes.post("/:id/fusiona", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest actor no existeix");
  const parsed = actorMergeSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "Tria amb quin actor fusionar-lo", 422);
  }

  await fusionaActors(id, parsed.data.altre_id, espai.id);

  const { filters, pagina, usuaris, tots } = await dades(espai.id, c.req.query());
  return fragment(
    c,
    Taula({ codi: espai.code, pagina, usuaris, tots, filters, potEditar: true }),
  );
});
