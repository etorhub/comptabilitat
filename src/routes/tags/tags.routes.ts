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
import { categoryOptions } from "../../services/categories.ts";
import {
  deleteTagFromWorkspace,
  workspaceTags,
  listTags,
  normalizeTag,
  summaryTag,
} from "../../services/tags.ts";
import { listTransactions } from "../../services/transactions.ts";
import { DetailTable } from "./tags.fragment.ts";
import { TagDetailPage, TagsPage } from "./tags.page.ts";
import {
  nameFromRoute,
  PER_PAGE,
  tagDetailQuerySchema,
  tagDetailToQuery,
} from "./tags.schema.ts";

export const tagsRoutes = new Hono();

function validName(valor: string | undefined): string {
  const name = nameFromRoute(valor);
  try {
    return normalizeTag(name);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("L'etiqueta no es valida", 422);
  }
}

async function detailData(ledgerId: number, name: string, query: Record<string, string>) {
  const filters = tagDetailQuerySchema.parse(query);
  const [summary, paged, groups, etiquetesConegudes] = await Promise.all([
    summaryTag(ledgerId, name),
    listTransactions(ledgerId, {
      accountId: null,
      dateFrom: null,
      dateTo: null,
      categoryIds: [],
      merchantId: null,
      search: "",
      tag: name,
      tipusOperacio: [],
      cards: [],
      nomesRevisio: false,
      nomesSenseClassificar: false,
      incloTraspassos: false,
      limit: PER_PAGE,
      offset: filters.pagina * PER_PAGE,
    }),
    categoryOptions(ledgerId),
    workspaceTags(ledgerId),
  ]);
  return { filters, summary, page: paged, groups, etiquetesConegudes };
}

// --- Pagina ----------------------------------------------------------------

tagsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const potEditar = roleAtLeast(currentRole(c), "editor");
  const tags = await listTags(workspace.id);

  return page(
    c,
    await workspacePage(c, "Etiquetes", TagsPage({ codi: workspace.code, tags, potEditar })),
  );
});

// Fragment abans de :nom perque Hono no confongui «fragment» amb un nom.
tagsRoutes.get("/:nom/fragment/taula", async (c) => {
  const workspace = currentWorkspace(c);
  const name = validName(c.req.param("nom"));
  const {
    page: paged,
    filters,
    summary,
    groups,
    etiquetesConegudes,
  } = await detailData(workspace.id, name, c.req.query());

  pushUrl(
    c,
    `/e/${workspace.code}/etiquetes/${encodeURIComponent(summary.name)}${tagDetailToQuery(filters)}`,
  );

  return fragment(
    c,
    DetailTable({
      codi: workspace.code,
      name: summary.name,
      page: paged,
      groups,
      potEditar: roleAtLeast(currentRole(c), "editor"),
      query: filters,
      etiquetesConegudes,
    }),
  );
});

tagsRoutes.get("/:nom", async (c) => {
  const workspace = currentWorkspace(c);
  const name = validName(c.req.param("nom"));
  const {
    page: paged,
    filters,
    summary,
    groups,
    etiquetesConegudes,
  } = await detailData(workspace.id, name, c.req.query());

  return page(
    c,
    await workspacePage(
      c,
      summary.name,
      TagDetailPage({
        codi: workspace.code,
        summary,
        page: paged,
        groups,
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
  const workspace = currentWorkspace(c);
  let name: string;
  try {
    name = validName(c.req.param("nom"));
  } catch (err) {
    if (err instanceof AppError) return toastOnly(c, err.message, err.status);
    throw err;
  }

  await deleteTagFromWorkspace(workspace.id, name);
  return redirect(c, `/e/${workspace.code}/etiquetes`);
});
