/**
 * Rutes de les categories.
 *
 * El cas que val la pena mirar es el `DELETE`: quan la categoria te moviments
 * i no s'ha dit on han d'anar, contesta **409** amb el formulari per triar-ho.
 * L'error no es un carreró sense sortida, es la pregunta que falta.
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

/** La vista d'una categoria, tal com la vol la fila de la taula. */
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

// --- Pagina ----------------------------------------------------------------

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

/** Una fila sola: serveix per cancel·lar una edicio o una reassignacio. */
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

/** La fila convertida en camp de text. */
categoriesRoutes.get("/:id/fragment/edicio", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta categoria no existeix");
  await categoryInWorkspace(id, workspace.id);

  const found = await viewOf(id, workspace.id);
  if (!found) return fragment(c, DeletedRow(id));

  return fragment(c, EditRow({ code: workspace.code, category: found.view }));
});

// --- Mutacions -------------------------------------------------------------

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

  // L'arbre sencer canvia (hi ha una fila nova, i potser un grup nou), aixi
  // que es torna sencer, fora de banda, amb el formulari net.
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
 * Esborrat.
 *
 * Si te moviments i no s'ha dit on van, `esborraCategoria` llança un 409 i
 * aqui el convertim en el formulari de reassignacio. La resta d'errors
 * (protegida, te filles) van al `#toast` com sempre.
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

      // Totes menys ella mateixa i les seves filles: moure-hi els moviments
      // no serviria de res si desapareix igualment.
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

  // Esborrar-ne una canvia els totals acumulats dels pares, aixi que l'arbre
  // torna sencer.
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
