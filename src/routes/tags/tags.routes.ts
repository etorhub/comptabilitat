/**
 * Routes of the tags resource.
 *
 * GET /etiquetes → page with totals.
 * GET /etiquetes/:nom → detail with transactions.
 * GET /etiquetes/:nom/fragment/taula → pagination fragment.
 * POST /etiquetes/:nom/esborra → removes the tag from the whole workspace.
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

function validName(value: string | undefined): string {
  const name = nameFromRoute(value);
  try {
    return normalizeTag(name);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("L'etiqueta no es valida", 422);
  }
}

async function detailData(ledgerId: number, name: string, query: Record<string, string>) {
  const filters = tagDetailQuerySchema.parse(query);
  const [summary, paged, groups, knownTags] = await Promise.all([
    summaryTag(ledgerId, name),
    listTransactions(ledgerId, {
      accountId: null,
      dateFrom: null,
      dateTo: null,
      categoryIds: [],
      merchantId: null,
      search: "",
      tag: name,
      operationType: [],
      cards: [],
      onlyReview: false,
      onlyUnclassified: false,
      includeTransfers: false,
      limit: PER_PAGE,
      offset: filters.pagina * PER_PAGE,
    }),
    categoryOptions(ledgerId),
    workspaceTags(ledgerId),
  ]);
  return { filters, summary, page: paged, groups, knownTags };
}

// --- Page ------------------------------------------------------------------

tagsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const canEdit = roleAtLeast(currentRole(c), "editor");
  const tags = await listTags(workspace.id);

  return page(
    c,
    await workspacePage(c, "Etiquetes", TagsPage({ code: workspace.code, tags, canEdit })),
  );
});

// Fragment before :nom so that Hono does not mistake «fragment» for a name.
tagsRoutes.get("/:nom/fragment/taula", async (c) => {
  const workspace = currentWorkspace(c);
  const name = validName(c.req.param("nom"));
  const {
    page: paged,
    filters,
    summary,
    groups,
    knownTags,
  } = await detailData(workspace.id, name, c.req.query());

  pushUrl(
    c,
    `/e/${workspace.code}/etiquetes/${encodeURIComponent(summary.name)}${tagDetailToQuery(filters)}`,
  );

  return fragment(
    c,
    DetailTable({
      code: workspace.code,
      name: summary.name,
      page: paged,
      groups,
      canEdit: roleAtLeast(currentRole(c), "editor"),
      query: filters,
      knownTags,
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
    knownTags,
  } = await detailData(workspace.id, name, c.req.query());

  return page(
    c,
    await workspacePage(
      c,
      summary.name,
      TagDetailPage({
        code: workspace.code,
        summary,
        page: paged,
        groups,
        canEdit: roleAtLeast(currentRole(c), "editor"),
        query: filters,
        knownTags,
      }),
    ),
  );
});

/**
 * Removes the tag from every transaction in the workspace and goes back to
 * the list.
 *
 * From both the index and the detail: the redirect saves having to decide
 * which piece to redraw.
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
