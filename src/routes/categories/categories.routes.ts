/**
 * Category routes.
 *
 * The case worth looking at is the `DELETE`: when the category has
 * transactions and no destination has been given, it answers **409** with the
 * form for choosing one. The error is not a dead end, it is the question that
 * is missing.
 */

import { Hono } from "hono";

import { zodErrors } from "../../components/form.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { clearToast, fragment, idFromRoute, page, toast, withOob } from "../../lib/http.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  categoryTree,
  categoryInWorkspace,
  createCategory,
  deleteCategory,
  categoryOptions,
  renameCategory,
} from "../../services/categories.ts";
import { Tree, Row, EditRow, DeletedRow, CreateForm } from "./categories.fragment.ts";
import { CategoriesPage } from "./categories.page.ts";
import { categoryCreateSchema, categoryUpdateSchema } from "./categories.schema.ts";

export const categoriesRoutes = new Hono();

/** The view of a category, as the table row wants it. */
async function viewOf(id: number, ledgerId: number) {
  const tree = await categoryTree(ledgerId);
  for (const nodes of Object.values(tree)) {
    for (const parent of nodes) {
      if (parent.id === id) {
        return { view: parent, child: false, childIds: parent.children.map((f) => f.id) };
      }
      const child = parent.children.find((f) => f.id === id);
      if (child) return { view: child, child: true, childIds: [] };
    }
  }
  return null;
}

// --- Page ------------------------------------------------------------------

categoriesRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const canEdit = roleAtLeast(currentRole(c), "editor");
  const [tree, groups] = await Promise.all([
    categoryTree(workspace.id),
    categoryOptions(workspace.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Categories",
      CategoriesPage({ code: workspace.code, tree, groups, canEdit }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

/** A single row: used to cancel an edit. */
categoriesRoutes.get("/:id/fragment/fila", async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");
  await categoryInWorkspace(id, workspace.id);

  const found = await viewOf(id, workspace.id);
  if (!found) return fragment(c, DeletedRow(id));

  return fragment(
    c,
    await withOob(
      Row({
        code: workspace.code,
        category: found.view,
        canEdit: roleAtLeast(currentRole(c), "editor"),
        child: found.child,
      }),
      clearToast(),
    ),
  );
});

/** The row turned into a text field. */
categoriesRoutes.get("/:id/fragment/edicio", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");
  await categoryInWorkspace(id, workspace.id);

  const found = await viewOf(id, workspace.id);
  if (!found) return fragment(c, DeletedRow(id));

  return fragment(c, EditRow({ code: workspace.code, category: found.view }));
});

// --- Mutations -------------------------------------------------------------

categoriesRoutes.post("/", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const body = await c.req.parseBody();
  const parsed = categoryCreateSchema.safeParse(body);

  const groups = await categoryOptions(workspace.id);

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        CreateForm({
          code: workspace.code,
          groups,
          errors: zodErrors(parsed.error),
          values: {
            name: typeof body.name === "string" ? body.name : "",
            kind: typeof body.kind === "string" ? body.kind : "expense",
            parent_id: typeof body.parent_id === "string" ? body.parent_id : "",
          },
        }),
        toast("Revisa el formulari", "error"),
      ),
      422,
    );
  }

  await createCategory(workspace.id, {
    name: parsed.data.name,
    kind: parsed.data.kind,
    parentId: parsed.data.parent_id,
    color: parsed.data.color,
    icon: parsed.data.icon,
  });

  // The whole tree changes (there is a new row, and maybe a new group), so it
  // is returned whole, out of band, with a clean form.
  const [tree, newGroups] = await Promise.all([
    categoryTree(workspace.id),
    categoryOptions(workspace.id),
  ]);

  return fragment(
    c,
    await withOob(
      CreateForm({ code: workspace.code, groups: newGroups }),
      Tree({ code: workspace.code, tree, canEdit: true, oob: true }),
      toast(`S'ha afegit «${parsed.data.name}»`, "success"),
    ),
  );
});

categoriesRoutes.patch("/:id", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");
  const body = await c.req.parseBody();
  const parsed = categoryUpdateSchema.safeParse(body);

  if (!parsed.success) {
    const found = await viewOf(id, workspace.id);
    if (!found) return fragment(c, DeletedRow(id));
    return fragment(
      c,
      await withOob(
        EditRow({ code: workspace.code, category: found.view }),
        toast(zodErrors(parsed.error).name?.[0] ?? "Revisa el nom", "error"),
      ),
      422,
    );
  }

  await renameCategory(id, workspace.id, parsed.data.name);

  const found = await viewOf(id, workspace.id);
  if (!found) return fragment(c, DeletedRow(id));

  return fragment(
    c,
    await withOob(
      Row({
        code: workspace.code,
        category: found.view,
        canEdit: true,
        child: found.child,
      }),
      clearToast(),
    ),
  );
});

/**
 * Deletion.
 *
 * A category with transactions cannot be deleted: they are never moved to
 * another one. `deleteCategory` throws a 409 and the error handler answers
 * with the `#toast` alone.
 */
categoriesRoutes.delete("/:id", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");

  await deleteCategory(id, workspace.id);

  // Deleting one changes the parents' accumulated totals, so the tree comes
  // back whole.
  //
  // The main swap is a comment, not `DeletedRow`: a bare `<tr>` ahead of the
  // tree's own `<table>` in the same response corrupts how the browser parses
  // everything after it, and the table that comes back out of band is what
  // silently loses all its rows (see `docs/why.md`). `routes/recurring`
  // already uses a comment for the same reason.
  const tree = await categoryTree(workspace.id);
  return fragment(
    c,
    await withOob(
      `<!-- categoria-${id} esborrada -->`,
      Tree({ code: workspace.code, tree, canEdit: true, oob: true }),
      toast("Categoria esborrada", "success"),
    ),
  );
});
