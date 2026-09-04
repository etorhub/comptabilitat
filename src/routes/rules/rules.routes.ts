/**
 * Rutes de les regles.
 */

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { ComptadorRevisio } from "../../components/layout.tsx";
import { zodErrors } from "../../components/form.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { categories, roleAtLeast, rules } from "../../db/schema/index.ts";
import {
  clearToast,
  fragment,
  NotFoundError,
  page,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { opcionsCategories } from "../../services/categories.ts";
import { comptaPerRevisar } from "../../services/comptadors.ts";
import { aplicaReglaAlsExistents } from "../../services/rules-apply.ts";
import { Fila, FilaEsborrada, FormAlta, Llista, type ReglaVista } from "./rules.fragment.tsx";
import { RulesPage } from "./rules.page.tsx";
import { ruleCreateSchema } from "./rules.schema.ts";

export const rulesRoutes = new Hono();

function idDeLaRuta(valor: string | undefined): number {
  const id = Number.parseInt(valor ?? "", 10);
  if (Number.isNaN(id)) throw new NotFoundError("Aquesta regla no existeix");
  return id;
}

/** Les regles de l'espai amb el nom de la categoria que assignen. */
async function llistaRegles(ledgerId: number): Promise<ReglaVista[]> {
  const files = await db
    .select({ regla: rules, categoryName: categories.name })
    .from(rules)
    .leftJoin(categories, eq(categories.id, rules.setCategoryId))
    .where(eq(rules.ledgerId, ledgerId))
    .orderBy(asc(rules.priority), asc(rules.id));

  return files.map((f) => ({ ...f.regla, categoryName: f.categoryName }));
}

async function reglaDeLespai(id: number, ledgerId: number) {
  const [regla] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, id), eq(rules.ledgerId, ledgerId)))
    .limit(1);
  if (!regla) throw new NotFoundError("Aquesta regla no existeix");
  return regla;
}

async function vistaRegla(id: number, ledgerId: number): Promise<ReglaVista> {
  const [fila] = await db
    .select({ regla: rules, categoryName: categories.name })
    .from(rules)
    .leftJoin(categories, eq(categories.id, rules.setCategoryId))
    .where(and(eq(rules.id, id), eq(rules.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquesta regla no existeix");
  return { ...fila.regla, categoryName: fila.categoryName };
}

// --- Pagina ----------------------------------------------------------------

rulesRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const [regles, grups] = await Promise.all([
    llistaRegles(espai.id),
    opcionsCategories(espai.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Regles",
      RulesPage({
        codi: espai.code,
        regles,
        grups,
        potEditar: roleAtLeast(currentRole(c), "editor"),
      }),
    ),
  );
});

// --- Mutacions -------------------------------------------------------------

rulesRoutes.post("/", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const user = currentUser(c);
  const cos = await c.req.parseBody({ all: true });
  const parsed = ruleCreateSchema.safeParse(cos);
  const grups = await opcionsCategories(espai.id);

  if (!parsed.success) {
    const text = (clau: string) => {
      const v = cos[clau];
      return typeof v === "string" ? v : "";
    };
    return fragment(
      c,
      await withOob(
        FormAlta({
          codi: espai.code,
          grups,
          errors: zodErrors(parsed.error),
          valors: {
            name: text("name"),
            priority: text("priority") || "100",
            set_category_id: text("set_category_id"),
            set_tags: text("set_tags"),
          },
        }),
        toast("Revisa el formulari"),
      ),
      422,
    );
  }

  // La categoria ha de ser d'aquest espai.
  if (parsed.data.setCategoryId !== null) {
    const [categoria] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, parsed.data.setCategoryId), eq(categories.ledgerId, espai.id)),
      )
      .limit(1);
    if (!categoria) {
      return toastOnly(c, "La categoria no es d'aquest espai", 422);
    }
  }

  const [creada] = await db
    .insert(rules)
    .values({
      name: parsed.data.name,
      ledgerId: espai.id,
      priority: parsed.data.priority,
      isActive: true,
      conditions: parsed.data.conditions,
      setCategoryId: parsed.data.setCategoryId,
      setMerchantId: null,
      setTags: parsed.data.setTags,
      source: "user",
      createdById: user.id,
      matchCount: 0,
    })
    .returning();

  let aplicats = 0;
  if (creada && parsed.data.applyNow) {
    aplicats = await aplicaReglaAlsExistents(creada);
  }

  const [regles, perRevisar] = await Promise.all([
    llistaRegles(espai.id),
    comptaPerRevisar(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      FormAlta({ codi: espai.code, grups }),
      LlistaOob({ codi: espai.code, regles }),
      ComptadorRevisio(perRevisar, true),
      toast(
        aplicats > 0
          ? `Regla creada i aplicada a ${aplicats} ${aplicats === 1 ? "moviment" : "moviments"}`
          : "Regla creada",
        "success",
      ),
    ),
  );
});

/** La llista sencera, fora de banda. */
function LlistaOob({ codi, regles }: { codi: string; regles: ReglaVista[] }) {
  return Llista({ codi, regles, potEditar: true, oob: true });
}

rulesRoutes.post("/:id/aplica", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const regla = await reglaDeLespai(id, espai.id);

  const aplicats = await aplicaReglaAlsExistents(regla);
  const [vista, perRevisar] = await Promise.all([
    vistaRegla(id, espai.id),
    comptaPerRevisar(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({ codi: espai.code, regla: vista, potEditar: true }),
      ComptadorRevisio(perRevisar, true),
      toast(
        aplicats > 0
          ? `Aplicada a ${aplicats} ${aplicats === 1 ? "moviment" : "moviments"}`
          : "No hi ha cap moviment nou que hi encaixi",
        aplicats > 0 ? "success" : "info",
      ),
    ),
  );
});

rulesRoutes.post("/:id/activa", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const regla = await reglaDeLespai(id, espai.id);

  await db.update(rules).set({ isActive: !regla.isActive }).where(eq(rules.id, id));

  return fragment(
    c,
    await withOob(
      Fila({ codi: espai.code, regla: await vistaRegla(id, espai.id), potEditar: true }),
      clearToast(),
    ),
  );
});

rulesRoutes.delete("/:id", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  await reglaDeLespai(id, espai.id);

  await db.delete(rules).where(eq(rules.id, id));

  return fragment(c, await withOob(FilaEsborrada(id), toast("Regla esborrada", "success")));
});
