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
 *
 * Dos programes i no un: `/moviments.csv` nomes te sentit sota `/moviments`,
 * i `/informe.xlsx`/`/informe.pdf` nomes sota `/informes`. Un sol
 * `exportsRoutes` muntat a totes dues adreces —com hi havia abans— feia que
 * cada descarrega respongues a **dues** adreces, una d'elles brossa
 * (`/moviments/informe.xlsx`, `/informes/moviments.csv`), contra la regla que
 * una adreça nomes retorna una cosa.
 */

import { Hono } from "hono";

import { AppError } from "../../lib/http.ts";
import { addDays, todayLocal } from "../../lib/time.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { informeAPdf, movimentsACsv, resumAXlsx } from "../../services/export.ts";
import { incomeAndExpenses, categoryBreakdown, monthlySeries } from "../../services/reports.ts";
import { listTransactions } from "../../services/transactions.ts";
import { exportFiltersSchema, MAX_ROWS, summarySchema } from "./exports.schema.ts";

export const transactionsExportRoutes = new Hono();
export const reportsExportRoutes = new Hono();

/** Nom de fitxer amb l'espai i el dia, com feia el Python. */
function fileName(code: string, extensio: string): string {
  const day = todayLocal().replace(/-/g, "");
  return `moviments-${code}-${day}.${extensio}`;
}

function capçaleres(name: string, type: string): Record<string, string> {
  return {
    "Content-Type": type,
    // El nom va entre cometes perque pot dur guions i punts.
    "Content-Disposition": `attachment; filename="${name}"`,
  };
}

async function transactionsToExport(ledgerId: number, query: Record<string, string>) {
  const filters = exportFiltersSchema.parse(query);
  const page = await listTransactions(ledgerId, {
    accountId: null,
    dateFrom: filters.des,
    dateTo: filters.fins,
    categoryIds: filters.category === null ? [] : [filters.category],
    merchantId: null,
    search: filters.search,
    tag: null,
    operationType: [],
    cards: [],
    onlyReview: false,
    onlyUnclassified: false,
    includeTransfers: filters.transfers,
    limit: MAX_ROWS,
    offset: 0,
  });

  if (page.total > MAX_ROWS) {
    throw new AppError(
      `Son ${page.total} moviments i el limit es ${MAX_ROWS}. Acota les dates.`,
      422,
    );
  }

  return page.items;
}

transactionsExportRoutes.get("/moviments.csv", async (c) => {
  const workspace = currentWorkspace(c);
  const transactionList = await transactionsToExport(workspace.id, c.req.query());

  return c.body(
    movimentsACsv(transactionList),
    200,
    capçaleres(fileName(workspace.code, "csv"), "text/csv; charset=utf-8"),
  );
});

reportsExportRoutes.get("/informe.xlsx", async (c) => {
  const workspace = currentWorkspace(c);
  const { months } = summarySchema.parse(c.req.query());
  const today = todayLocal();
  const des = addDays(today, -months * 31);

  const [monthly, categories] = await Promise.all([
    monthlySeries([workspace.id], des, today),
    categoryBreakdown([workspace.id], des, today, true),
  ]);

  return c.body(
    await resumAXlsx(monthly, categories),
    200,
    capçaleres(
      `informe-${workspace.code}-${today.replace(/-/g, "")}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
});

reportsExportRoutes.get("/informe.pdf", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = exportFiltersSchema.parse(c.req.query());
  const today = todayLocal();
  // Per defecte, el mes que corre.
  const des = filters.des ?? `${today.slice(0, 7)}-01`;
  const fins = filters.fins ?? today;

  const [totals, monthly, categories] = await Promise.all([
    incomeAndExpenses([workspace.id], des, fins),
    monthlySeries([workspace.id], des, fins),
    categoryBreakdown([workspace.id], des, fins, true),
  ]);

  const pdf = await informeAPdf({
    workspaceName: workspace.name,
    des,
    fins,
    income: totals.income,
    expenses: totals.expenses,
    cleaned: totals.cleaned,
    monthly,
    categories,
  });

  return c.body(
    pdf,
    200,
    capçaleres(`informe-${workspace.code}-${today.replace(/-/g, "")}.pdf`, "application/pdf"),
  );
});
