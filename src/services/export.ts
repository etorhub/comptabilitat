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
import type { MovimentVista } from "./transactions.ts";
import type { PuntMensual, TrosCategoria } from "./reports.ts";

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
function fila(m: MovimentVista): (string | number)[] {
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

function escapaCsv(valor: string): string {
  if (/[";\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

/**
 * CSV amb punt i coma i BOM, que es el que espera l'Excel en espanyol; els
 * decimals amb coma, pel mateix motiu.
 */
export function movimentsACsv(moviments: MovimentVista[]): Uint8Array<ArrayBuffer> {
  const linies: string[] = [COLUMNES.map(([nom]) => escapaCsv(nom)).join(";")];

  for (const moviment of moviments) {
    linies.push(
      fila(moviment)
        .map((valor, i) => {
          // La columna de l'import va amb coma decimal.
          if (i === 6) return money(String(valor)).toFixed(2).replace(".", ",");
          return escapaCsv(String(valor));
        })
        .join(";"),
    );
  }

  const text = `﻿${linies.join("\r\n")}\r\n`;
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

// --- XLSX ------------------------------------------------------------------

function capçalera(full: ExcelJS.Worksheet, columnes: [string, number][]): void {
  full.columns = columnes.map(([nom, amplada]) => ({ header: nom, width: amplada }));
  const fila1 = full.getRow(1);
  fila1.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  fila1.alignment = { vertical: "middle" };
}

export async function movimentsAXlsx(
  moviments: MovimentVista[],
): Promise<Uint8Array<ArrayBuffer>> {
  const llibre = new ExcelJS.Workbook();
  llibre.creator = "Comptabilitat";
  const full = llibre.addWorksheet("Moviments");

  capçalera(full, COLUMNES);

  for (const moviment of moviments) {
    const valors = fila(moviment);
    full.addRow([...valors.slice(0, 6), Number(moviment.amount), ...valors.slice(7)]);
  }

  full.getColumn(7).numFmt = '#,##0.00 "€"';
  full.getColumn(1).numFmt = "yyyy-mm-dd";
  full.views = [{ state: "frozen", ySplit: 1 }];
  full.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNES.length } };

  const buffer = await llibre.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function resumAXlsx(
  mensual: PuntMensual[],
  categories: TrosCategoria[],
): Promise<Uint8Array<ArrayBuffer>> {
  const llibre = new ExcelJS.Workbook();
  llibre.creator = "Comptabilitat";

  const mesos = llibre.addWorksheet("Mes a mes");
  capçalera(mesos, [
    ["Periode", 12],
    ["Ingressos", 14],
    ["Despeses", 14],
    ["Resultat", 14],
  ]);
  for (const punt of mensual) {
    mesos.addRow([
      punt.periode,
      Number(punt.ingressos),
      Number(punt.despeses),
      Number(punt.net),
    ]);
  }
  for (const col of [2, 3, 4]) mesos.getColumn(col).numFmt = '#,##0.00 "€"';

  const cats = llibre.addWorksheet("Categories");
  capçalera(cats, [
    ["Categoria", 30],
    ["Import", 14],
    ["Part", 10],
    ["Moviments", 12],
  ]);
  for (const tros of categories) {
    cats.addRow([tros.categoryName, Number(tros.amount), tros.share, tros.transactions]);
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
  nomEspai: string;
  des: string;
  fins: string;
  ingressos: string;
  despeses: string;
  net: string;
  mensual: PuntMensual[];
  categories: TrosCategoria[];
}

export function informeAPdf(dades: DadesInforme): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Informe · ${dades.nomEspai}` },
    });
    const trossos: Buffer[] = [];

    doc.on("data", (t: Buffer) => trossos.push(t));
    doc.on("end", () => {
      const complet = Buffer.concat(trossos);
      const sortida = new Uint8Array(new ArrayBuffer(complet.byteLength));
      sortida.set(complet);
      resolve(sortida);
    });
    doc.on("error", reject);

    const AMPLADA = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor("#0f172a").text(dades.nomEspai);
    doc.fontSize(10).fillColor("#64748b").text(`Informe del ${dades.des} al ${dades.fins}`);
    doc.moveDown(1.2);

    // Resum
    doc.fontSize(11).fillColor("#0f172a");
    const resum: [string, string][] = [
      ["Ingressos", formatMoney(dades.ingressos)],
      ["Despeses", formatMoney(dades.despeses)],
      ["Resultat", formatMoney(dades.net)],
    ];
    for (const [etiqueta, valor] of resum) {
      doc.font("Helvetica").fillColor("#64748b").text(etiqueta, { continued: true });
      doc.font("Helvetica-Bold").fillColor("#0f172a").text(`   ${valor}`, { align: "right" });
    }
    doc.moveDown(1.2);

    const taula = (
      titol: string,
      capceleres: string[],
      files: string[][],
      amplades: number[],
    ) => {
      if (doc.y > doc.page.height - 160) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(titol);
      doc.moveDown(0.4);

      const x0 = doc.page.margins.left;
      const columnes = amplades.map((p) => (AMPLADA * p) / 100);

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748b");
      let y = doc.y;
      capceleres.forEach((text, i) => {
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
      for (const f of files) {
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

    taula(
      "Mes a mes",
      ["Periode", "Ingressos", "Despeses", "Resultat"],
      dades.mensual.map((p) => [
        p.periode,
        formatMoney(p.ingressos),
        formatMoney(p.despeses),
        formatMoney(p.net),
      ]),
      [28, 24, 24, 24],
    );

    taula(
      "Despeses per categoria",
      ["Categoria", "Import", "Part", "Moviments"],
      dades.categories.map((t) => [
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
