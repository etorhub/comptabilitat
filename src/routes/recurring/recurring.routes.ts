/**
 * Rutes de les series recurrents (schedules).
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { recurringSeries, roleAtLeast } from "../../db/schema/index.ts";
import { ConflictError } from "../../lib/http.ts";
import { clearToast, fragment, idDeLaRuta, page, pushUrl, withOob } from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { confirmaSerie, descartaSerie } from "../../services/recurring.ts";
import { llistaSeries, serieDeLespai, vistaSerie } from "../../services/recurring-list.ts";
import { FilaActiva, Taula } from "./recurring.fragment.tsx";
import { RecurringPage } from "./recurring.page.tsx";
import {
  confirmaSerieSchema,
  recurringFiltersSchema,
  recurringFiltersToQuery,
} from "./recurring.schema.ts";

export const recurringRoutes = new Hono();

recurringRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const [propostes, actives] = await Promise.all([
    llistaSeries(espai.id, { estats: ["suggested"] }),
    llistaSeries(espai.id, {
      estats: filters.inclou_acabades ? ["active", "ended"] : ["active"],
    }),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Recurrents",
      RecurringPage({
        codi: espai.code,
        propostes,
        actives,
        filters,
        potEditar: roleAtLeast(currentRole(c), "editor"),
      }),
    ),
  );
});

recurringRoutes.get("/fragment/propostes", async (c) => {
  const espai = currentWorkspace(c);
  const propostes = await llistaSeries(espai.id, { estats: ["suggested"] });
  return fragment(
    c,
    Taula({
      codi: espai.code,
      series: propostes,
      potEditar: roleAtLeast(currentRole(c), "editor"),
      idContenidor: "taula-recurrents-propostes",
      sonPropostes: true,
      buit: "No hi ha cap proposta nova.",
    }),
  );
});

recurringRoutes.get("/fragment/actives", async (c) => {
  const espai = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const actives = await llistaSeries(espai.id, {
    estats: filters.inclou_acabades ? ["active", "ended"] : ["active"],
  });

  pushUrl(c, `/e/${espai.code}/recurrents${recurringFiltersToQuery(filters)}`);

  return fragment(
    c,
    Taula({
      codi: espai.code,
      series: actives,
      potEditar: roleAtLeast(currentRole(c), "editor"),
      idContenidor: "taula-recurrents-actives",
      buit: "Encara no hi ha cap rebut confirmat.",
    }),
  );
});

recurringRoutes.post("/:id/previsio", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquesta serie no existeix");
  const serie = await serieDeLespai(id, espai.id);
  const cos = await c.req.parseBody();

  await db
    .update(recurringSeries)
    .set({ includeInForecast: cos.include_in_forecast !== undefined })
    .where(eq(recurringSeries.id, serie.id));

  const vista = await vistaSerie(id, espai.id);
  return fragment(
    c,
    await withOob(
      FilaActiva({ codi: espai.code, serie: vista, potEditar: true }),
      clearToast(),
    ),
  );
});

recurringRoutes.post("/:id/confirma", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquesta serie no existeix");
  const serie = await serieDeLespai(id, espai.id);
  if (serie.status !== "suggested") {
    throw new ConflictError("Aquesta serie ja no es una proposta");
  }

  const cos = await c.req.parseBody();
  const dades = confirmaSerieSchema.parse({
    cadence: cos.cadence,
    amount_mode: cos.amount_mode,
  });

  await confirmaSerie(id, { cadence: dades.cadence, amountMode: dades.amount_mode });

  const actives = await llistaSeries(espai.id, { estats: ["active"] });
  return fragment(
    c,
    await withOob(
      `<!-- serie-${id} confirmada -->`,
      Taula({
        codi: espai.code,
        series: actives,
        potEditar: true,
        idContenidor: "taula-recurrents-actives",
        buit: "Encara no hi ha cap rebut confirmat.",
        oob: true,
      }),
      clearToast(),
    ),
  );
});

recurringRoutes.post("/:id/descarta", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquesta serie no existeix");
  await serieDeLespai(id, espai.id);
  await descartaSerie(id);
  return fragment(c, await withOob(`<!-- serie-${id} descartada -->`, clearToast()));
});
