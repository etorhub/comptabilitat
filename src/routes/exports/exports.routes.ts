/**
 * Descarregues: CSV, XLSX (informes) i PDF.
 *
 * Son enllaços normals (`<a href>`), no peticions d'HTMX: el navegador ja sap
 * descarregar un fitxer, i la galeta de sessio hi viatja igual. A l'aplicacio
 * de React aixo era un `window.open`.
 *
 * El que et descarregues es el que estas veient: els filtres son els mateixos
 * i, sobretot, **les dades passen per `vistaMoviment()`**, de manera que un
 * moviment emmascarat surt emmascarat tambe al full de calcul.
 */

import { Hono } from "hono";

import { AppError, page } from "../../lib/http.ts";
import { addDays, todayLocal } from "../../lib/time.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { informeAPdf, movimentsACsv, resumAXlsx } from "../../services/export.ts";
import {
  ingressosIDespeses,
  repartimentCategories,
  serieMensual,
} from "../../services/reports.ts";
import { llistaMoviments } from "../../services/transactions.ts";
import { exportFiltersSchema, MAX_FILES, summarySchema } from "./exports.schema.ts";

export const exportsRoutes = new Hono();

/** Nom de fitxer amb l'espai i el dia, com feia el Python. */
function nomFitxer(codi: string, extensio: string): string {
  const dia = todayLocal().replace(/-/g, "");
  return `moviments-${codi}-${dia}.${extensio}`;
}

function capçaleres(nom: string, tipus: string): Record<string, string> {
  return {
    "Content-Type": tipus,
    // El nom va entre cometes perque pot dur guions i punts.
    "Content-Disposition": `attachment; filename="${nom}"`,
  };
}

async function movimentsPerExportar(ledgerId: number, query: Record<string, string>) {
  const filters = exportFiltersSchema.parse(query);
  const pagina = await llistaMoviments(ledgerId, {
    accountId: null,
    dataDes: filters.des,
    dataFins: filters.fins,
    categoryIds: filters.categoria === null ? [] : [filters.categoria],
    merchantId: null,
    cerca: filters.cerca,
    etiqueta: null,
    tipusOperacio: [],
    nomesRevisio: false,
    nomesSenseClassificar: false,
    incloTraspassos: filters.traspassos,
    limit: MAX_FILES,
    offset: 0,
  });

  if (pagina.total > MAX_FILES) {
    throw new AppError(
      `Son ${pagina.total} moviments i el limit es ${MAX_FILES}. Acota les dates.`,
      422,
    );
  }

  return pagina.items;
}

exportsRoutes.get("/moviments.csv", async (c) => {
  const espai = currentWorkspace(c);
  const moviments = await movimentsPerExportar(espai.id, c.req.query());

  return c.body(
    movimentsACsv(moviments),
    200,
    capçaleres(nomFitxer(espai.code, "csv"), "text/csv; charset=utf-8"),
  );
});

exportsRoutes.get("/informe.xlsx", async (c) => {
  const espai = currentWorkspace(c);
  const { mesos } = summarySchema.parse(c.req.query());
  const avui = todayLocal();
  const des = addDays(avui, -mesos * 31);

  const [mensual, categories] = await Promise.all([
    serieMensual([espai.id], des, avui),
    repartimentCategories([espai.id], des, avui, true),
  ]);

  return c.body(
    await resumAXlsx(mensual, categories),
    200,
    capçaleres(
      `informe-${espai.code}-${avui.replace(/-/g, "")}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
});

exportsRoutes.get("/informe.pdf", async (c) => {
  const espai = currentWorkspace(c);
  const filters = exportFiltersSchema.parse(c.req.query());
  const avui = todayLocal();
  // Per defecte, el mes que corre.
  const des = filters.des ?? `${avui.slice(0, 7)}-01`;
  const fins = filters.fins ?? avui;

  const [totals, mensual, categories] = await Promise.all([
    ingressosIDespeses([espai.id], des, fins),
    serieMensual([espai.id], des, fins),
    repartimentCategories([espai.id], des, fins, true),
  ]);

  const pdf = await informeAPdf({
    nomEspai: espai.name,
    des,
    fins,
    ingressos: totals.ingressos,
    despeses: totals.despeses,
    net: totals.net,
    mensual,
    categories,
  });

  return c.body(
    pdf,
    200,
    capçaleres(`informe-${espai.code}-${avui.replace(/-/g, "")}.pdf`, "application/pdf"),
  );
});

export { page };
