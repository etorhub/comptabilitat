/**
 * Rutes del recurs d'etiquetes.
 *
 * GET /etiquetes → pagina amb sumes.
 * GET /etiquetes/:nom → detall amb moviments.
 * GET /etiquetes/:nom/fragment/taula → fragment de paginacio.
 * POST /etiquetes/:nom/esborra → treu l'etiqueta de tot l'espai.
 */

import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { AppError, fragment, page, pushUrl, redirect, toastOnly } from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { opcionsCategories } from "../../services/categories.ts";
import {
  esborraEtiquetaDeLespai,
  etiquetesEspai,
  llistaEtiquetes,
  normalitzaEtiqueta,
  resumEtiqueta,
} from "../../services/tags.ts";
import { llistaMoviments } from "../../services/transactions.ts";
import { TaulaDetall } from "./tags.fragment.tsx";
import { TagDetailPage, TagsPage } from "./tags.page.tsx";
import {
  nomDeLaRuta,
  PER_PAGINA,
  tagDetailQuerySchema,
  tagDetailToQuery,
} from "./tags.schema.ts";

export const tagsRoutes = new Hono();

function nomValid(valor: string | undefined): string {
  const nom = nomDeLaRuta(valor);
  try {
    return normalitzaEtiqueta(nom);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("L'etiqueta no es valida", 422);
  }
}

async function dadesDetall(ledgerId: number, nom: string, query: Record<string, string>) {
  const filters = tagDetailQuerySchema.parse(query);
  const [resum, pagina, grups, etiquetesConegudes] = await Promise.all([
    resumEtiqueta(ledgerId, nom),
    llistaMoviments(ledgerId, {
      accountId: null,
      dataDes: null,
      dataFins: null,
      categoryIds: [],
      merchantId: null,
      cerca: "",
      etiqueta: nom,
      tipusOperacio: [],
      targetes: [],
      nomesRevisio: false,
      nomesSenseClassificar: false,
      incloTraspassos: false,
      limit: PER_PAGINA,
      offset: filters.pagina * PER_PAGINA,
    }),
    opcionsCategories(ledgerId),
    etiquetesEspai(ledgerId),
  ]);
  return { filters, resum, pagina, grups, etiquetesConegudes };
}

// --- Pagina ----------------------------------------------------------------

tagsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const potEditar = roleAtLeast(currentRole(c), "editor");
  const etiquetes = await llistaEtiquetes(espai.id);

  return page(
    c,
    await workspacePage(c, "Etiquetes", TagsPage({ codi: espai.code, etiquetes, potEditar })),
  );
});

// Fragment abans de :nom perque Hono no confongui «fragment» amb un nom.
tagsRoutes.get("/:nom/fragment/taula", async (c) => {
  const espai = currentWorkspace(c);
  const nom = nomValid(c.req.param("nom"));
  const { filters, resum, pagina, grups, etiquetesConegudes } = await dadesDetall(
    espai.id,
    nom,
    c.req.query(),
  );

  pushUrl(
    c,
    `/e/${espai.code}/etiquetes/${encodeURIComponent(resum.nom)}${tagDetailToQuery(filters)}`,
  );

  return fragment(
    c,
    TaulaDetall({
      codi: espai.code,
      nom: resum.nom,
      pagina,
      grups,
      potEditar: roleAtLeast(currentRole(c), "editor"),
      query: filters,
      etiquetesConegudes,
    }),
  );
});

tagsRoutes.get("/:nom", async (c) => {
  const espai = currentWorkspace(c);
  const nom = nomValid(c.req.param("nom"));
  const { filters, resum, pagina, grups, etiquetesConegudes } = await dadesDetall(
    espai.id,
    nom,
    c.req.query(),
  );

  return page(
    c,
    await workspacePage(
      c,
      resum.nom,
      TagDetailPage({
        codi: espai.code,
        resum,
        pagina,
        grups,
        potEditar: roleAtLeast(currentRole(c), "editor"),
        query: filters,
        etiquetesConegudes,
      }),
    ),
  );
});

/**
 * Treu l'etiqueta de tots els moviments de l'espai i torna a la llista.
 *
 * Tant des de l'index com des del detall: la redireccio evita haver de
 * decidir quin tros redibuixar.
 */
tagsRoutes.post("/:nom/esborra", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  let nom: string;
  try {
    nom = nomValid(c.req.param("nom"));
  } catch (err) {
    if (err instanceof AppError) return toastOnly(c, err.message, err.status);
    throw err;
  }

  await esborraEtiquetaDeLespai(espai.id, nom);
  return redirect(c, `/e/${espai.code}/etiquetes`);
});
