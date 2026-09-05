/**
 * Rutes dels comerços.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import { ComptadorRevisio } from "../../components/layout.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { roleAtLeast, transactions } from "../../db/schema/index.ts";
import {
  clearToast,
  fragment,
  idDeLaRuta,
  page,
  pushUrl,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { opcionsCategories } from "../../services/categories.ts";
import { comptaPerRevisar } from "../../services/comptadors.ts";
import { assignaCategoria, llistaComercos, vistaComerc } from "../../services/merchants.ts";
import { declaraComercRecurrent, inferCadencia } from "../../services/recurring.ts";
import { resumSubscripcions } from "../../services/recurring-list.ts";
import { ResumSubscripcionsFragment } from "../recurring/recurring.fragment.tsx";
import { Fila, Taula } from "./merchants.fragment.tsx";
import { MerchantsPage } from "./merchants.page.tsx";
import {
  merchantCategorySchema,
  merchantFiltersSchema,
  merchantFiltersToQuery,
  merchantRecurrentSchema,
  PER_PAGINA,
} from "./merchants.schema.ts";

export const merchantsRoutes = new Hono();

async function dades(ledgerId: number, query: Record<string, string>) {
  const filters = merchantFiltersSchema.parse(query);
  const [pagina, grups] = await Promise.all([
    llistaComercos(ledgerId, {
      cerca: filters.cerca,
      nomesSenseClassificar: filters.sense_classificar,
      nomesSenseConfirmar: filters.sense_confirmar,
      limit: PER_PAGINA,
      offset: filters.pagina * PER_PAGINA,
    }),
    opcionsCategories(ledgerId),
  ]);
  return { filters, pagina, grups };
}

// --- Pagina ----------------------------------------------------------------

merchantsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, grups } = await dades(espai.id, c.req.query());

  return page(
    c,
    await workspacePage(
      c,
      "Comerços",
      MerchantsPage({
        codi: espai.code,
        pagina,
        grups,
        filters,
        potEditar: roleAtLeast(currentRole(c), "editor"),
      }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

merchantsRoutes.get("/fragment/taula", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, grups } = await dades(espai.id, c.req.query());

  pushUrl(c, `/e/${espai.code}/comercos${merchantFiltersToQuery(filters)}`);

  return fragment(
    c,
    Taula({
      codi: espai.code,
      pagina,
      grups,
      filters,
      potEditar: roleAtLeast(currentRole(c), "editor"),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

/**
 * Assignar la categoria d'un comerç la propaga als seus moviments que no
 * hagi classificat una persona. Aixo pot treure moviments de la safata de
 * revisio, i per aixo el comptador torna fora de banda.
 */
merchantsRoutes.post("/:id/categoria", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest comerç no existeix");
  const parsed = merchantCategorySchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "La categoria no es valida", 422);
  }

  const canviats = await assignaCategoria(
    id,
    espai.id,
    parsed.data.default_category_id,
    parsed.data.aplica_existents,
  );

  const [comerc, grups, perRevisar] = await Promise.all([
    vistaComerc(id, espai.id),
    opcionsCategories(espai.id),
    comptaPerRevisar(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({ codi: espai.code, comerc, grups, potEditar: true }),
      ComptadorRevisio(perRevisar, true),
      canviats > 0
        ? toast(
            `S'ha aplicat a ${canviats} ${canviats === 1 ? "moviment" : "moviments"}`,
            "success",
          )
        : clearToast(),
    ),
  );
});

/**
 * Marcar un comerç com a recurrent crea (o refresca) la serie que la previsio
 * ja sap projectar. Si la serie es una subscripcio, el resum de Recurrents
 * canvia i torna fora de banda.
 */
merchantsRoutes.post("/:id/recurrent", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquest comerç no existeix");
  const parsed = merchantRecurrentSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "La cadencia no es valida", 422);
  }

  let cadence = parsed.data.recurrent_cadence ?? null;
  if (parsed.data.is_recurrent && cadence === null) {
    const dates = await db
      .select({ bookingDate: transactions.bookingDate })
      .from(transactions)
      .where(
        and(
          eq(transactions.ledgerId, espai.id),
          eq(transactions.merchantId, id),
          eq(transactions.status, "booked"),
          isNull(transactions.transferGroupId),
          eq(transactions.isExcluded, false),
        ),
      )
      .orderBy(asc(transactions.bookingDate));
    cadence = inferCadencia(dates.map((d) => d.bookingDate));
  }

  await declaraComercRecurrent(id, espai.id, {
    recurrent: parsed.data.is_recurrent,
    cadence,
  });

  const [comerc, grups, resum] = await Promise.all([
    vistaComerc(id, espai.id),
    opcionsCategories(espai.id),
    resumSubscripcions(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({ codi: espai.code, comerc, grups, potEditar: true }),
      ResumSubscripcionsFragment({ resum, oob: true }),
      clearToast(),
    ),
  );
});
