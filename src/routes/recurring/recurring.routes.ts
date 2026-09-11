/**
 * Rutes de les series recurrents (schedules).
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { recurringSeries, roleAtLeast } from "../../db/schema/index.ts";
import { ConflictError } from "../../lib/http.ts";
import {
  clearToast,
  fragment,
  idDeLaRuta,
  page,
  pushUrl,
  toast,
  withOob,
} from "../../lib/http.ts";
import { money, toMoneyString } from "../../lib/money.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { opcionsCategories } from "../../services/categories.ts";
import {
  actualitzaImportSerie,
  confirmaSerie,
  creaSerieManual,
  descartaSerie,
} from "../../services/recurring.ts";
import { llistaSeries, serieDeLespai, vistaSerie } from "../../services/recurring-list.ts";
import { FilaActiva, FormAlta, Taula } from "./recurring.fragment.tsx";
import { RecurringPage } from "./recurring.page.tsx";
import {
  actualitzaImportSchema,
  confirmaSerieSchema,
  creaSerieSchema,
  recurringFiltersSchema,
  recurringFiltersToQuery,
} from "./recurring.schema.ts";

export const recurringRoutes = new Hono();

recurringRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const potEditar = roleAtLeast(currentRole(c), "editor");
  const [propostes, actives, grups] = await Promise.all([
    llistaSeries(espai.id, { estats: ["suggested"] }),
    llistaSeries(espai.id, {
      estats: filters.inclou_acabades ? ["active", "ended"] : ["active"],
    }),
    potEditar ? opcionsCategories(espai.id) : Promise.resolve([]),
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
        potEditar,
        grups,
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

recurringRoutes.post("/", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const cos = await c.req.parseBody();
  const parsed = creaSerieSchema.safeParse(cos);
  const grups = await opcionsCategories(espai.id);

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        FormAlta({
          codi: espai.code,
          grups,
          valors: {
            label: typeof cos.label === "string" ? cos.label : "",
            category_id:
              typeof cos.category_id === "string" && cos.category_id !== ""
                ? Number(cos.category_id)
                : undefined,
            cadence: typeof cos.cadence === "string" ? (cos.cadence as never) : undefined,
            amount: typeof cos.amount === "string" ? cos.amount : "",
            sentit: cos.sentit === "in" ? "in" : "out",
            next_expected_date:
              typeof cos.next_expected_date === "string" ? cos.next_expected_date : undefined,
          },
          errors: zodErrors(parsed.error),
        }),
        toast("Revisa el formulari", "error"),
      ),
      422,
    );
  }

  const dades = parsed.data;
  const signed = dades.sentit === "out" ? money(dades.amount).negated() : money(dades.amount);

  await creaSerieManual(espai.id, {
    label: dades.label,
    categoryId: dades.category_id,
    cadence: dades.cadence,
    expectedAmount: toMoneyString(signed),
    nextExpectedDate: dades.next_expected_date,
  });

  const actives = await llistaSeries(espai.id, { estats: ["active"] });
  return fragment(
    c,
    await withOob(
      FormAlta({ codi: espai.code, grups }),
      Taula({
        codi: espai.code,
        series: actives,
        potEditar: true,
        idContenidor: "taula-recurrents-actives",
        buit: "Encara no hi ha cap rebut confirmat.",
        oob: true,
      }),
      toast(`S'ha afegit «${dades.label}»`, "success"),
    ),
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

recurringRoutes.post("/:id/import", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"), "Aquesta serie no existeix");
  const serie = await serieDeLespai(id, espai.id);
  if (serie.status !== "active") {
    throw new ConflictError("Nomes es pot editar l'import d'una serie activa");
  }

  const cos = await c.req.parseBody();
  const parsed = actualitzaImportSchema.safeParse(cos);
  if (!parsed.success) {
    const vista = await vistaSerie(id, espai.id);
    return fragment(
      c,
      await withOob(
        FilaActiva({ codi: espai.code, serie: vista, potEditar: true }),
        toast(zodErrors(parsed.error).amount?.[0] ?? "Revisa l'import", "error"),
      ),
      422,
    );
  }

  // Conserva el sentit de la serie; el formulari envia el valor absolut.
  const signe = money(serie.expectedAmount).isNegative() ? -1 : 1;
  const nou = money(parsed.data.amount).abs().times(signe);

  await actualitzaImportSerie(id, toMoneyString(nou));

  const vista = await vistaSerie(id, espai.id);
  return fragment(
    c,
    await withOob(
      FilaActiva({ codi: espai.code, serie: vista, potEditar: true }),
      toast("S'ha actualitzat l'import", "success"),
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
