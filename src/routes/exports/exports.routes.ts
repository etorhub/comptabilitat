/**
 * Downloads: CSV, XLSX (reports) and PDF.
 *
 * They are ordinary links (`<a href>`), not HTMX requests: the browser
 * already knows how to download a file, and the session cookie travels with
 * it all the same. In the React application this was a `window.open`.
 *
 * What you download is what you are looking at: the filters are the same and,
 * above all, **the data goes through `transactionView()`**, so a masked
 * transaction comes out masked in the spreadsheet too.
 *
 * Two programs and not one: `/moviments.csv` only makes sense under
 * `/moviments`, and `/informe.xlsx`/`/informe.pdf` only under `/informes`. A
 * single `exportsRoutes` mounted at both URLs —as there used to be— made each
 * download answer at **two** URLs, one of them junk
 * (`/moviments/informe.xlsx`, `/informes/moviments.csv`), against the rule
 * that a URL returns one thing only.
 */

import { Hono } from "hono";

import { AppError } from "../../lib/http.ts";
import { addDays, todayLocal } from "../../lib/time.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { reportToPdf, transactionsToCsv, resumAXlsx } from "../../services/export.ts";
import { incomeAndExpenses, categoryBreakdown, monthlySeries } from "../../services/reports.ts";
import { listTransactions } from "../../services/transactions.ts";
import { exportFiltersSchema, MAX_ROWS, summarySchema } from "./exports.schema.ts";

export const transactionsExportRoutes = new Hono();
export const reportsExportRoutes = new Hono();

/** File name with the workspace and the day, as the Python did. */
function fileName(code: string, extensio: string): string {
  const day = todayLocal().replace(/-/g, "");
  return `moviments-${code}-${day}.${extensio}`;
}

function capçaleres(name: string, type: string): Record<string, string> {
  return {
    "Content-Type": type,
    // The name goes in quotes because it can carry hyphens and dots.
    "Content-Disposition": `attachment; filename="${name}"`,
  };
}

async function transactionsToExport(ledgerId: number, query: Record<string, string>) {
  const filters = exportFiltersSchema.parse(query);
  const page = await listTransactions(ledgerId, {
    accountId: null,
    dateFrom: filters.des,
    dateTo: filters.to,
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
    transactionsToCsv(transactionList),
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
  // By default, the current month.
  const des = filters.des ?? `${today.slice(0, 7)}-01`;
  const to = filters.to ?? today;

  const [totals, monthly, categories] = await Promise.all([
    incomeAndExpenses([workspace.id], des, to),
    monthlySeries([workspace.id], des, to),
    categoryBreakdown([workspace.id], des, to, true),
  ]);

  const pdf = await reportToPdf({
    workspaceName: workspace.name,
    des,
    to,
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
