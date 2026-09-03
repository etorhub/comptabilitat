/**
 * Rutes de les categories.
 *
 * El cas que val la pena mirar es el `DELETE`: quan la categoria te moviments
 * i no s'ha dit on han d'anar, contesta **409** amb el formulari per triar-ho.
 * L'error no es un carreró sense sortida, es la pregunta que falta.
 */

import { Hono } from "hono";

import { zodErrors } from "../../components/form.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { clearToast, ConflictError, fragment, page, toast, withOob } from "../../lib/http.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  arbreCategories,
  categoriaDeLespai,
  creaCategoria,
  esborraCategoria,
  marcaSubscripcio,
  movimentsDe,
  opcionsCategories,
  reanomenaCategoria,
} from "../../services/categories.ts";
import {
  Arbre,
  Fila,
  FilaEdicio,
  FilaEsborrada,
  FormAlta,
  FormReassignacio,
} from "./categories.fragment.tsx";
import { CategoriesPage } from "./categories.page.tsx";
import {
  categoryCreateSchema,
  categoryDeleteSchema,
  categoryUpdateSchema,
} from "./categories.schema.ts";

export const categoriesRoutes = new Hono();

function idDeLaRuta(valor: string | undefined): number {
  const id = Number.parseInt(valor ?? "", 10);
  if (Number.isNaN(id)) throw new ConflictError("Identificador no valid");
  return id;
}

/** La vista d'una categoria, tal com la vol la fila de la taula. */
async function vistaDe(id: number, ledgerId: number) {
  const arbre = await arbreCategories(ledgerId);
  for (const nodes of Object.values(arbre)) {
    for (const pare of nodes) {
      if (pare.id === id) {
        return { vista: pare, filla: false, fillesIds: pare.filles.map((f) => f.id) };
      }
      const filla = pare.filles.find((f) => f.id === id);
      if (filla) return { vista: filla, filla: true, fillesIds: [] };
    }
  }
  return null;
}

// --- Pagina ----------------------------------------------------------------

categoriesRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const potEditar = roleAtLeast(currentRole(c), "editor");
  const [arbre, grups] = await Promise.all([
    arbreCategories(espai.id),
    opcionsCategories(espai.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Categories",
      CategoriesPage({ codi: espai.code, arbre, grups, potEditar }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

/** Una fila sola: serveix per cancel·lar una edicio o una reassignacio. */
categoriesRoutes.get("/:id/fragment/fila", async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  await categoriaDeLespai(id, espai.id);

  const trobada = await vistaDe(id, espai.id);
  if (!trobada) return fragment(c, FilaEsborrada(id));

  return fragment(
    c,
    await withOob(
      Fila({
        codi: espai.code,
        categoria: trobada.vista,
        potEditar: roleAtLeast(currentRole(c), "editor"),
        filla: trobada.filla,
      }),
      clearToast(),
    ),
  );
});

/** La fila convertida en camp de text. */
categoriesRoutes.get("/:id/fragment/edicio", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  await categoriaDeLespai(id, espai.id);

  const trobada = await vistaDe(id, espai.id);
  if (!trobada) return fragment(c, FilaEsborrada(id));

  return fragment(c, FilaEdicio({ codi: espai.code, categoria: trobada.vista }));
});

// --- Mutacions -------------------------------------------------------------

categoriesRoutes.post("/", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const cos = await c.req.parseBody();
  const parsed = categoryCreateSchema.safeParse(cos);

  const grups = await opcionsCategories(espai.id);

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        FormAlta({
          codi: espai.code,
          grups,
          errors: zodErrors(parsed.error),
          valors: {
            name: typeof cos.name === "string" ? cos.name : "",
            kind: typeof cos.kind === "string" ? cos.kind : "expense",
            parent_id: typeof cos.parent_id === "string" ? cos.parent_id : "",
          },
        }),
        toast("Revisa el formulari", "error"),
      ),
      422,
    );
  }

  await creaCategoria(espai.id, {
    name: parsed.data.name,
    kind: parsed.data.kind,
    parentId: parsed.data.parent_id,
    color: parsed.data.color,
    icon: parsed.data.icon,
    isSubscription: parsed.data.is_subscription,
  });

  // L'arbre sencer canvia (hi ha una fila nova, i potser un grup nou), aixi
  // que es torna sencer, fora de banda, amb el formulari net.
  const [arbre, grupsNous] = await Promise.all([
    arbreCategories(espai.id),
    opcionsCategories(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      FormAlta({ codi: espai.code, grups: grupsNous }),
      Arbre({ codi: espai.code, arbre, potEditar: true, oob: true }),
      toast(`S'ha afegit «${parsed.data.name}»`, "success"),
    ),
  );
});

categoriesRoutes.patch("/:id", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const cos = await c.req.parseBody();
  const parsed = categoryUpdateSchema.safeParse(cos);

  if (!parsed.success) {
    const trobada = await vistaDe(id, espai.id);
    if (!trobada) return fragment(c, FilaEsborrada(id));
    return fragment(
      c,
      await withOob(
        FilaEdicio({ codi: espai.code, categoria: trobada.vista }),
        toast(zodErrors(parsed.error).name?.[0] ?? "Revisa el nom", "error"),
      ),
      422,
    );
  }

  await reanomenaCategoria(id, espai.id, parsed.data.name);

  const trobada = await vistaDe(id, espai.id);
  if (!trobada) return fragment(c, FilaEsborrada(id));

  return fragment(
    c,
    await withOob(
      Fila({
        codi: espai.code,
        categoria: trobada.vista,
        potEditar: true,
        filla: trobada.filla,
      }),
      clearToast(),
    ),
  );
});

categoriesRoutes.post("/:id/subscripcio", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const cos = await c.req.parseBody();
  // Una casella que no ve al cos vol dir «desmarcada».
  const marcada = cos.is_subscription !== undefined;

  await marcaSubscripcio(id, espai.id, marcada);

  const trobada = await vistaDe(id, espai.id);
  if (!trobada) return fragment(c, FilaEsborrada(id));

  return fragment(
    c,
    await withOob(
      Fila({
        codi: espai.code,
        categoria: trobada.vista,
        potEditar: true,
        filla: trobada.filla,
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
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = categoryDeleteSchema.safeParse({
    ...(await c.req.parseBody().catch(() => ({}))),
    ...c.req.query(),
  });
  const reassignTo = parsed.success ? parsed.data.reassign_to : null;

  try {
    await esborraCategoria(id, espai.id, reassignTo);
  } catch (error) {
    if (error instanceof ConflictError) {
      const trobada = await vistaDe(id, espai.id);
      if (!trobada) return fragment(c, FilaEsborrada(id));

      // Totes menys ella mateixa i les seves filles: moure-hi els moviments
      // no serviria de res si desapareix igualment.
      const excloure = [id, ...trobada.fillesIds];
      const grups = await opcionsCategories(espai.id, excloure);

      return fragment(
        c,
        await withOob(
          FormReassignacio({
            codi: espai.code,
            categoria: trobada.vista,
            moviments: await movimentsDe(id),
            grups,
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
  const arbre = await arbreCategories(espai.id);
  return fragment(
    c,
    await withOob(
      FilaEsborrada(id),
      Arbre({ codi: espai.code, arbre, potEditar: true, oob: true }),
      toast("Categoria esborrada", "success"),
    ),
  );
});
