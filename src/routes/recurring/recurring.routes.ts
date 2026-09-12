/**
 * Routes of the recurring series (schedules).
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { recurringSeries, roleAtLeast } from "../../db/schema/index.ts";
import { ConflictError } from "../../lib/http.ts";
import {
  clearToast,
  fragment,
  idFromRoute,
  page,
  pushUrl,
  toast,
  withOob,
} from "../../lib/http.ts";
import { money, toMoneyString } from "../../lib/money.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { categoryOptions } from "../../services/categories.ts";
import {
  updateSeriesAmount,
  confirmSeries,
  createSeriesManual,
  dismissSeries,
} from "../../services/recurring.ts";
import {
  listSeries,
  seriesInWorkspace,
  seriesView,
  seriesOccurrences,
} from "../../services/recurring-list.ts";
import { ActiveRow, CreateForm, Table } from "./recurring.fragment.ts";
import { RecurringPage } from "./recurring.page.ts";
import {
  updateAmountSchema,
  confirmSeriesSchema,
  createSeriesSchema,
  recurringFiltersSchema,
  recurringFiltersToQuery,
} from "./recurring.schema.ts";

export const recurringRoutes = new Hono();

recurringRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const canEdit = roleAtLeast(currentRole(c), "editor");
  const [proposals, active, groups] = await Promise.all([
    listSeries(workspace.id, { statuses: ["suggested"] }),
    listSeries(workspace.id, {
      statuses: filters.inclou_acabades ? ["active", "ended"] : ["active"],
    }),
    canEdit ? categoryOptions(workspace.id) : Promise.resolve([]),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Recurrents",
      RecurringPage({
        code: workspace.code,
        proposals,
        active,
        filters,
        canEdit,
        groups,
      }),
    ),
  );
});

recurringRoutes.get("/fragment/propostes", async (c) => {
  const workspace = currentWorkspace(c);
  const proposals = await listSeries(workspace.id, { statuses: ["suggested"] });
  return fragment(
    c,
    Table({
      code: workspace.code,
      series: proposals,
      canEdit: roleAtLeast(currentRole(c), "editor"),
      containerId: "taula-recurrents-propostes",
      areProposals: true,
      empty: "No hi ha cap proposta nova.",
    }),
  );
});

recurringRoutes.get("/fragment/actives", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = recurringFiltersSchema.parse(c.req.query());
  const active = await listSeries(workspace.id, {
    statuses: filters.inclou_acabades ? ["active", "ended"] : ["active"],
  });

  pushUrl(c, `/e/${workspace.code}/recurrents${recurringFiltersToQuery(filters)}`);

  return fragment(
    c,
    Table({
      code: workspace.code,
      series: active,
      canEdit: roleAtLeast(currentRole(c), "editor"),
      containerId: "taula-recurrents-actives",
      empty: "Encara no hi ha cap rebut confirmat.",
    }),
  );
});

recurringRoutes.get("/:id/fragment/fila", async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta serie no existeix");
  const editant = c.req.query("editant") === "1";
  const show = !editant && c.req.query("mostra") === "1";
  const canEdit = roleAtLeast(currentRole(c), "editor");
  const view = await seriesView(id, workspace.id);
  const occurrences = show ? await seriesOccurrences(id, workspace.id) : null;

  return fragment(
    c,
    ActiveRow({
      code: workspace.code,
      series: view,
      canEdit,
      editant: canEdit && editant,
      occurrences,
    }),
  );
});

recurringRoutes.post("/", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const body = await c.req.parseBody();
  const parsed = createSeriesSchema.safeParse(body);
  const groups = await categoryOptions(workspace.id);

  if (!parsed.success) {
    return fragment(
      c,
      await withOob(
        CreateForm({
          code: workspace.code,
          groups,
          values: {
            label: typeof body.label === "string" ? body.label : "",
            category_id:
              typeof body.category_id === "string" && body.category_id !== ""
                ? Number(body.category_id)
                : undefined,
            cadence: typeof body.cadence === "string" ? (body.cadence as never) : undefined,
            amount: typeof body.amount === "string" ? body.amount : "",
            sentit: body.sentit === "in" ? "in" : "out",
            next_expected_date:
              typeof body.next_expected_date === "string" ? body.next_expected_date : undefined,
          },
          errors: zodErrors(parsed.error),
        }),
        toast("Revisa el formulari", "error"),
      ),
      422,
    );
  }

  const data = parsed.data;
  const signed = data.sentit === "out" ? money(data.amount).negated() : money(data.amount);

  await createSeriesManual(workspace.id, {
    label: data.label,
    categoryId: data.category_id,
    cadence: data.cadence,
    expectedAmount: toMoneyString(signed),
    nextExpectedDate: data.next_expected_date,
  });

  const active = await listSeries(workspace.id, { statuses: ["active"] });
  return fragment(
    c,
    await withOob(
      CreateForm({ code: workspace.code, groups }),
      Table({
        code: workspace.code,
        series: active,
        canEdit: true,
        containerId: "taula-recurrents-actives",
        empty: "Encara no hi ha cap rebut confirmat.",
        oob: true,
      }),
      toast(`S'ha afegit «${data.label}»`, "success"),
    ),
  );
});

recurringRoutes.post("/:id/previsio", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta serie no existeix");
  const series = await seriesInWorkspace(id, workspace.id);
  const body = await c.req.parseBody();

  await db
    .update(recurringSeries)
    .set({ includeInForecast: body.include_in_forecast !== undefined })
    .where(eq(recurringSeries.id, series.id));

  const view = await seriesView(id, workspace.id);
  return fragment(
    c,
    await withOob(
      ActiveRow({ code: workspace.code, series: view, canEdit: true }),
      clearToast(),
    ),
  );
});

recurringRoutes.post("/:id/import", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta serie no existeix");
  const series = await seriesInWorkspace(id, workspace.id);
  if (series.status !== "active") {
    throw new ConflictError("Nomes es pot editar l'import d'una serie activa");
  }

  const body = await c.req.parseBody();
  const parsed = updateAmountSchema.safeParse(body);
  if (!parsed.success) {
    const view = await seriesView(id, workspace.id);
    return fragment(
      c,
      await withOob(
        ActiveRow({ code: workspace.code, series: view, canEdit: true, editant: true }),
        toast(zodErrors(parsed.error).amount?.[0] ?? "Revisa l'import", "error"),
      ),
      422,
    );
  }

  // Keeps the series' direction; the form sends the absolute value.
  const signe = money(series.expectedAmount).isNegative() ? -1 : 1;
  const fresh = money(parsed.data.amount).abs().times(signe);

  await updateSeriesAmount(id, toMoneyString(fresh));

  const view = await seriesView(id, workspace.id);
  return fragment(
    c,
    await withOob(
      ActiveRow({ code: workspace.code, series: view, canEdit: true }),
      toast("S'ha actualitzat l'import", "success"),
    ),
  );
});

recurringRoutes.post("/:id/confirma", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta serie no existeix");
  const series = await seriesInWorkspace(id, workspace.id);
  if (series.status !== "suggested") {
    throw new ConflictError("Aquesta serie ja no es una proposta");
  }

  const body = await c.req.parseBody();
  const data = confirmSeriesSchema.parse({
    cadence: body.cadence,
    amount_mode: body.amount_mode,
  });

  await confirmSeries(id, { cadence: data.cadence, amountMode: data.amount_mode });

  const active = await listSeries(workspace.id, { statuses: ["active"] });
  return fragment(
    c,
    await withOob(
      `<!-- serie-${id} confirmada -->`,
      Table({
        code: workspace.code,
        series: active,
        canEdit: true,
        containerId: "taula-recurrents-actives",
        empty: "Encara no hi ha cap rebut confirmat.",
        oob: true,
      }),
      clearToast(),
    ),
  );
});

recurringRoutes.post("/:id/descarta", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta serie no existeix");
  await seriesInWorkspace(id, workspace.id);
  await dismissSeries(id);
  return fragment(c, await withOob(`<!-- serie-${id} descartada -->`, clearToast()));
});
