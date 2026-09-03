/**
 * Rutes de les series recurrents.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { recurringSeries, roleAtLeast } from "../../db/schema/index.ts";
import { clearToast, fragment, NotFoundError, page, pushUrl, withOob } from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  llistaSeries,
  resumSubscripcions,
  serieDeLespai,
  vistaSerie,
} from "../../services/recurring-list.ts";
import { Fila, ResumSubscripcionsFragment, Taula } from "./recurring.fragment.tsx";
import { RecurringPage } from "./recurring.page.tsx";
import { recurringFiltersSchema, recurringFiltersToQuery } from "./recurring.schema.ts";

export const recurringRoutes = new Hono();

function idDeLaRuta(valor: string | undefined): number {
  const id = Number.parseInt(valor ?? "", 10);
  if (Number.isNaN(id)) throw new NotFoundError("Aquesta serie no existeix");
  return id;
}

// --- Pagina ----------------------------------------------------------------

recurringRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const [series, resum] = await Promise.all([
    llistaSeries(espai.id, filters.nomes_subscripcions, filters.inclou_acabades),
    resumSubscripcions(espai.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Recurrents",
      RecurringPage({
        codi: espai.code,
        series,
        resum,
        filters,
        potEditar: roleAtLeast(currentRole(c), "editor"),
      }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

recurringRoutes.get("/fragment/taula", async (c) => {
  const espai = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const series = await llistaSeries(
    espai.id,
    filters.nomes_subscripcions,
    filters.inclou_acabades,
  );

  pushUrl(c, `/e/${espai.code}/recurrents${recurringFiltersToQuery(filters)}`);

  return fragment(
    c,
    Taula({
      codi: espai.code,
      series,
      potEditar: roleAtLeast(currentRole(c), "editor"),
    }),
  );
});

// --- Mutacions -------------------------------------------------------------

/**
 * Treure una serie de la previsio no la esborra: nomes deixa de comptar per
 * al saldo projectat. Com que el resum de subscripcions en depen, torna fora
 * de banda.
 */
recurringRoutes.post("/:id/previsio", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const serie = await serieDeLespai(id, espai.id);
  const cos = await c.req.parseBody();

  await db
    .update(recurringSeries)
    .set({ includeInForecast: cos.include_in_forecast !== undefined })
    .where(eq(recurringSeries.id, serie.id));

  const [vista, resum] = await Promise.all([
    vistaSerie(id, espai.id),
    resumSubscripcions(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({ codi: espai.code, serie: vista, potEditar: true }),
      ResumSubscripcionsFragment({ resum, oob: true }),
      clearToast(),
    ),
  );
});
