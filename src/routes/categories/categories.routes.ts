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
import {
  ConflictError,
  clearToast,
  fragment,
  idFromRoute,
  page,
  toast,
  withOob,
} from "../../lib/http.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  categoryTree,
  categoryInWorkspace,
  createCategory,
  deleteCategory,
  transactionsOf,
  categoryOptions,
  renameCategory,
} from "../../services/categories.ts";
import {
  Tree,
  Row,
  EditRow,
  DeletedRow,
  CreateForm,
  ReassignmentForm,
} from "./categories.fragment.ts";
import { CategoriesPage } from "./categories.page.ts";
import {
  categoryCreateSchema,
  categoryDeleteSchema,
  categoryUpdateSchema,
} from "./categories.schema.ts";

export const categoriesRoutes = new Hono();

/** The view of a category, as the table row wants it. */
async function viewOf(id: number, ledgerId: number) {
  const tree = await categoryTree(ledgerId);
  for (const nodes of Object.values(tree)) {
    for (const parent of nodes) {
      if (parent.id === id) {
        return { view: parent, filla: false, fillesIds: parent.filles.map((f) => f.id) };
      }
      const filla = parent.filles.find((f) => f.id === id);
      if (filla) return { view: filla, filla: true, fillesIds: [] };
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

/** A single row: used to cancel an edit or a reassignment. */
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
        filla: found.filla,
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
  const [tree, grupsNous] = await Promise.all([
    categoryTree(workspace.id),
    categoryOptions(workspace.id),
  ]);

  return fragment(
    c,
    await withOob(
      CreateForm({ code: workspace.code, groups: grupsNous }),
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
        filla: found.filla,
      }),
      clearToast(),
    ),
  );
});

/**
 * Deletion.
 *
 * If it has transactions and no destination has been given, `deleteCategory`
 * throws a 409 and here we turn it into the reassignment form. The rest of
 * the errors (protected, has children) go to the `#toast` as always.
 */
categoriesRoutes.delete("/:id", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");
  const parsed = categoryDeleteSchema.safeParse({
    ...(await c.req.parseBody().catch(() => ({}))),
    ...c.req.query(),
  });
  const reassignTo = parsed.success ? parsed.data.reassign_to : null;

  try {
    await deleteCategory(id, workspace.id, reassignTo);
  } catch (error) {
    if (error instanceof ConflictError) {
      const found = await viewOf(id, workspace.id);
      if (!found) return fragment(c, DeletedRow(id));

      // All but itself and its children: moving the transactions there would
      // be pointless if it disappears anyway.
      const excloure = [id, ...found.fillesIds];
      const groups = await categoryOptions(workspace.id, excloure);

      return fragment(
        c,
        await withOob(
          ReassignmentForm({
            code: workspace.code,
            category: found.view,
            transactionList: await transactionsOf(id),
            groups,
          }),
          toast(error.message, "info", error.detail),
        ),
        409,
      );
    }
    throw error;
  }

  // Deleting one changes the parents' accumulated totals, so the tree comes
  // back whole.
  const tree = await categoryTree(workspace.id);
  return fragment(
    c,
    await withOob(
      DeletedRow(id),
      Tree({ code: workspace.code, tree, canEdit: true, oob: true }),
      toast("Categoria esborrada", "success"),
    ),
  );
});
