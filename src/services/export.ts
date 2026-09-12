/**
 * Generacio de CSV, XLSX i PDF.
 *
 * Aquest fitxer nomes dibuixa: no toca la base de dades. Les dades li arriben
 * ja emmascarades (`MovimentVista`), de manera que **un moviment amagat surt
 * amagat tambe als fitxers exportats**. Aixo importa: un full de calcul es
 * exactament el lloc on el concepte del banc tornaria a apareixer si
 * l'emmascarament nomes fos cosa de la pantalla.
 *
 * Traduccio de `backend/app/services/export.py`.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import { money, formatMoney } from "../lib/money.ts";
import type { TransactionView } from "./transactions.ts";
import type { MonthlyPoint, CategoryPart } from "./reports.ts";

const COLUMNES: [string, number][] = [
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

/** Una fila, ja emmascarada: `MovimentVista` no duu el concepte del banc. */
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

function escapaCsv(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV amb punt i coma i BOM, que es el que espera l'Excel en espanyol; els
 * decimals amb coma, pel mateix motiu.
 */
export function movimentsACsv(transactionList: TransactionView[]): Uint8Array<ArrayBuffer> {
  const linies: string[] = [COLUMNES.map(([name]) => escapaCsv(name)).join(";")];

  for (const transaction of transactionList) {
    linies.push(
      row(transaction)
        .map((value, i) => {
          // La columna de l'import va amb coma decimal.
          if (i === 6) return money(String(value)).toFixed(2).replace(".", ",");
          return escapaCsv(String(value));
        })
        .join(";"),
    );
  }

  const text = `﻿${linies.join("\r\n")}\r\n`;
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

// --- XLSX ------------------------------------------------------------------

function capçalera(full: ExcelJS.Worksheet, columnes: [string, number][]): void {
  full.columns = columnes.map(([name, amplada]) => ({ header: name, width: amplada }));
  const fila1 = full.getRow(1);
  fila1.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  fila1.alignment = { vertical: "middle" };
}

export async function resumAXlsx(
  monthly: MonthlyPoint[],
  categories: CategoryPart[],
): Promise<Uint8Array<ArrayBuffer>> {
  const llibre = new ExcelJS.Workbook();
  llibre.creator = "Comptabilitat";

  const months = llibre.addWorksheet("Mes a mes");
  capçalera(months, [
    ["Periode", 12],
    ["Ingressos", 14],
    ["Despeses", 14],
    ["Resultat", 14],
  ]);
  for (const punt of monthly) {
    months.addRow([
      punt.periode,
      Number(punt.income),
      Number(punt.expenses),
      Number(punt.cleaned),
    ]);
  }
  for (const col of [2, 3, 4]) months.getColumn(col).numFmt = '#,##0.00 "€"';

  const cats = llibre.addWorksheet("Categories");
  capçalera(cats, [
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

  const buffer = await llibre.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

// --- PDF -------------------------------------------------------------------

/**
 * Informe en PDF.
 *
 * Es fa amb `pdfkit`: no demana cap binari del sistema ni cap navegador sense
 * cap, cosa que importa perque aixo ha de funcionar en un NAS. Les taules
 * s'hi dibuixen a ma, que es el preu de no dependre de res mes.
 */
export interface DadesInforme {
  workspaceName: string;
  des: string;
  fins: string;
  income: string;
  expenses: string;
  cleaned: string;
  monthly: MonthlyPoint[];
  categories: CategoryPart[];
}

export function informeAPdf(data: DadesInforme): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Informe · ${data.workspaceName}` },
    });
    const parts: Buffer[] = [];

    doc.on("data", (t: Buffer) => parts.push(t));
    doc.on("end", () => {
      const complet = Buffer.concat(parts);
      const output = new Uint8Array(new ArrayBuffer(complet.byteLength));
      output.set(complet);
      resolve(output);
    });
    doc.on("error", reject);

    const AMPLADA = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor("#0f172a").text(data.workspaceName);
    doc.fontSize(10).fillColor("#64748b").text(`Informe del ${data.des} al ${data.fins}`);
    doc.moveDown(1.2);

    // Resum
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

    const table = (title: string, headers: string[], rows: string[][], amplades: number[]) => {
      if (doc.y > doc.page.height - 160) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(title);
      doc.moveDown(0.4);

      const x0 = doc.page.margins.left;
      const columnes = amplades.map((p) => (AMPLADA * p) / 100);

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748b");
      let y = doc.y;
      headers.forEach((text, i) => {
        const x = x0 + columnes.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(text, x, y, { width: columnes[i], align: i === 0 ? "left" : "right" });
      });
      y = doc.y + 4;
      doc
        .moveTo(x0, y)
        .lineTo(x0 + AMPLADA, y)
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
          const x = x0 + columnes.slice(0, i).reduce((a, b) => a + b, 0);
          doc.text(text, x, fy, { width: columnes[i], align: i === 0 ? "left" : "right" });
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
