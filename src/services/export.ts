/**
 * Generation of CSV, XLSX and PDF.
 *
 * This file only draws: it does not touch the database. The data reaches it
 * already masked (`TransactionView`), so **a hidden transaction comes out
 * hidden in the exported files too**. This matters: a spreadsheet is exactly
 * the place where the bank's concept would reappear if the masking were only
 * a screen matter.
 *
 * A translation of `backend/app/services/export.py`.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import { money, formatMoney } from "../lib/money.ts";
import type { TransactionView } from "./transactions.ts";
import type { MonthlyPoint, CategoryPart } from "./reports.ts";

const COLUMNS: [string, number][] = [
  ["Data", 12],
  ["Data valor", 12],
  ["Compte", 22],
  ["Concepte", 60],
  ["Comerç", 28],
  ["Categoria", 28],
  ["Import", 14],
  ["Moneda", 8],
  ["Estat", 12],
  ["Etiquetes", 20],
  ["Notes", 30],
];

/** A row, already masked: `TransactionView` does not carry the bank's concept. */
function row(m: TransactionView): (string | number)[] {
  return [
    m.bookingDate,
    m.valueDate ?? "",
    m.accountName ?? "",
    m.description,
    m.merchantName ?? "",
    m.categoryName ?? "",
    m.amount,
    m.currency,
    m.status,
    m.tags.join(", "),
    m.notes,
  ];
}

// --- CSV -------------------------------------------------------------------

function escapeCsv(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV with semicolons and a BOM, which is what Spanish Excel expects; the
 * decimals with a comma, for the same reason.
 */
export function transactionsToCsv(transactionList: TransactionView[]): Uint8Array<ArrayBuffer> {
  const lines: string[] = [COLUMNS.map(([name]) => escapeCsv(name)).join(";")];

  for (const transaction of transactionList) {
    lines.push(
      row(transaction)
        .map((value, i) => {
          // The amount column goes with a decimal comma.
          if (i === 6) return money(String(value)).toFixed(2).replace(".", ",");
          return escapeCsv(String(value));
        })
        .join(";"),
    );
  }

  const text = `﻿${lines.join("\r\n")}\r\n`;
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

// --- XLSX ------------------------------------------------------------------

function header(full: ExcelJS.Worksheet, columns: [string, number][]): void {
  full.columns = columns.map(([name, width]) => ({ header: name, width: width }));
  const row1 = full.getRow(1);
  row1.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  row1.alignment = { vertical: "middle" };
}

export async function summaryToXlsx(
  monthly: MonthlyPoint[],
  categories: CategoryPart[],
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Comptabilitat";

  const months = workbook.addWorksheet("Mes a mes");
  header(months, [
    ["Periode", 12],
    ["Ingressos", 14],
    ["Despeses", 14],
    ["Resultat", 14],
  ]);
  for (const point of monthly) {
    months.addRow([
      point.periode,
      Number(point.income),
      Number(point.expenses),
      Number(point.cleaned),
    ]);
  }
  for (const col of [2, 3, 4]) months.getColumn(col).numFmt = '#,##0.00 "€"';

  const cats = workbook.addWorksheet("Categories");
  header(cats, [
    ["Categoria", 30],
    ["Import", 14],
    ["Part", 10],
    ["Moviments", 12],
  ]);
  for (const part of categories) {
    cats.addRow([part.categoryName, Number(part.amount), part.share, part.transactions]);
  }
  cats.getColumn(2).numFmt = '#,##0.00 "€"';
  cats.getColumn(3).numFmt = "0.0%";

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

// --- PDF -------------------------------------------------------------------

/**
 * PDF report.
 *
 * It is done with `pdfkit`: it asks for no system binary and no headless
 * browser, which matters because this has to work on a NAS. The tables are
 * drawn by hand, which is the price of depending on nothing else.
 */
export interface ReportData {
  workspaceName: string;
  des: string;
  to: string;
  income: string;
  expenses: string;
  cleaned: string;
  monthly: MonthlyPoint[];
  categories: CategoryPart[];
}

export function reportToPdf(data: ReportData): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Informe · ${data.workspaceName}` },
    });
    const parts: Buffer[] = [];

    doc.on("data", (t: Buffer) => parts.push(t));
    doc.on("end", () => {
      const full = Buffer.concat(parts);
      const output = new Uint8Array(new ArrayBuffer(full.byteLength));
      output.set(full);
      resolve(output);
    });
    doc.on("error", reject);

    const WIDTH = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor("#0f172a").text(data.workspaceName);
    doc.fontSize(10).fillColor("#64748b").text(`Informe del ${data.des} al ${data.to}`);
    doc.moveDown(1.2);

    // Summary
    doc.fontSize(11).fillColor("#0f172a");
    const summary: [string, string][] = [
      ["Ingressos", formatMoney(data.income)],
      ["Despeses", formatMoney(data.expenses)],
      ["Resultat", formatMoney(data.cleaned)],
    ];
    for (const [tag, value] of summary) {
      doc.font("Helvetica").fillColor("#64748b").text(tag, { continued: true });
      doc.font("Helvetica-Bold").fillColor("#0f172a").text(`   ${value}`, { align: "right" });
    }
    doc.moveDown(1.2);

    const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
      if (doc.y > doc.page.height - 160) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(title);
      doc.moveDown(0.4);

      const x0 = doc.page.margins.left;
      const columns = widths.map((p) => (WIDTH * p) / 100);

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748b");
      let y = doc.y;
      headers.forEach((text, i) => {
        const x = x0 + columns.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(text, x, y, { width: columns[i], align: i === 0 ? "left" : "right" });
      });
      y = doc.y + 4;
      doc
        .moveTo(x0, y)
        .lineTo(x0 + WIDTH, y)
        .strokeColor("#e2e8f0")
        .stroke();
      doc.y = y + 6;

      doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a");
      for (const f of rows) {
        if (doc.y > doc.page.height - 70) {
          doc.addPage();
          doc.y = doc.page.margins.top;
        }
        const fy = doc.y;
        f.forEach((text, i) => {
          const x = x0 + columns.slice(0, i).reduce((a, b) => a + b, 0);
          doc.text(text, x, fy, { width: columns[i], align: i === 0 ? "left" : "right" });
        });
        doc.y = fy + 15;
      }
      doc.moveDown(1);
    };

    table(
      "Mes a mes",
      ["Periode", "Ingressos", "Despeses", "Resultat"],
      data.monthly.map((p) => [
        p.periode,
        formatMoney(p.income),
        formatMoney(p.expenses),
        formatMoney(p.cleaned),
      ]),
      [28, 24, 24, 24],
    );

    table(
      "Despeses per categoria",
      ["Categoria", "Import", "Part", "Moviments"],
      data.categories.map((t) => [
        t.categoryName,
        formatMoney(t.amount),
        `${Math.round(t.share * 100)}%`,
        String(t.transactions),
      ]),
      [46, 22, 14, 18],
    );

    doc.end();
  });
}
