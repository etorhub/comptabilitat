/**
 * Exportacions.
 *
 * El que importa aqui no es el format sino que **l'emmascarament hi arribi**.
 * Un full de calcul es exactament el lloc on el concepte del banc tornaria a
 * apareixer si amagar-lo nomes fos cosa de la pantalla.
 */

import { describe, expect, test } from "bun:test";

import { informeAPdf, movimentsACsv, resumAXlsx } from "../src/services/export.ts";
import type { MovimentVista } from "../src/services/transactions.ts";

const normal: MovimentVista = {
  id: 1,
  accountId: 1,
  accountName: "Compte corrent",
  bookingDate: "2026-03-01",
  valueDate: null,
  amount: "-45.20",
  currency: "EUR",
  status: "booked",
  description: "COMPRA TARJ. CLINICA DISCRETA",
  counterparty: "Clinica Discreta SL",
  merchantId: 3,
  merchantName: "Clinica Discreta",
  categoryId: 5,
  categoryName: "Salut",
  categorySource: "user",
  categoryConfidence: 1,
  needsReview: false,
  transferGroupId: null,
  notes: "",
  tags: ["salut"],
  isExcluded: false,
  isMasked: false,
};

/** El mateix moviment, ja passat per `vistaMoviment()` amb alies. */
const amagat: MovimentVista = {
  ...normal,
  id: 2,
  description: "Despesa personal",
  counterparty: "",
  merchantName: null,
  isMasked: true,
};

function textCsv(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("CSV", () => {
  test("va amb BOM, punt i coma i decimals amb coma", () => {
    const bytes = movimentsACsv([normal]);
    // El BOM es mira als bytes: `TextDecoder` se'l menja en descodificar.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = textCsv(bytes);
    expect(csv.split("\r\n")[0]).toContain(";");
    expect(csv).toContain("-45,20");
    expect(csv).not.toContain("-45.20");
  });

  test("un moviment emmascarat hi surt amagat", () => {
    const csv = textCsv(movimentsACsv([amagat]));
    expect(csv).toContain("Despesa personal");
    expect(csv).not.toContain("CLINICA DISCRETA");
    expect(csv).not.toContain("Clinica Discreta");
  });

  test("les cometes i els punts i coma del text no trenquen les columnes", () => {
    const complicat: MovimentVista = {
      ...normal,
      description: 'Ell va dir "hola"; i prou',
      notes: "linia 1\nlinia 2",
    };
    const csv = textCsv(movimentsACsv([complicat]));
    const files = csv.replace("﻿", "").split("\r\n").filter(Boolean);
    // La capçalera i una fila; el salt de linia de dins va entre cometes.
    expect(csv).toContain('"Ell va dir ""hola""; i prou"');
    expect(files[0]?.split(";")).toHaveLength(11);
  });
});

describe("XLSX", () => {
  test("el resum porta els dos fulls", async () => {
    const bytes = await resumAXlsx(
      [{ periode: "2026-01", ingressos: "100.00", despeses: "50.00", net: "50.00" }],
      [
        {
          categoryId: 1,
          categoryName: "Salut",
          color: "#ef4444",
          amount: "50.00",
          share: 1,
          transactions: 2,
        },
      ],
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("PDF", () => {
  test("es un PDF valid i no es buit", async () => {
    const bytes = await informeAPdf({
      nomEspai: "Personal",
      des: "2026-01-01",
      fins: "2026-03-31",
      ingressos: "1000.00",
      despeses: "400.00",
      net: "600.00",
      mensual: [
        { periode: "2026-01", ingressos: "1000.00", despeses: "400.00", net: "600.00" },
      ],
      categories: [
        {
          categoryId: 1,
          categoryName: "Salut",
          color: "#ef4444",
          amount: "400.00",
          share: 1,
          transactions: 3,
        },
      ],
    });

    const capçalera = new TextDecoder().decode(bytes.slice(0, 8));
    expect(capçalera).toBe("%PDF-1.3");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  test("aguanta un informe llarg sense petar", async () => {
    const mensual = Array.from({ length: 60 }, (_, i) => ({
      periode: `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      ingressos: "1000.00",
      despeses: "400.00",
      net: "600.00",
    }));
    const categories = Array.from({ length: 40 }, (_, i) => ({
      categoryId: i,
      categoryName: `Categoria ${i}`,
      color: "#94a3b8",
      amount: "10.00",
      share: 0.025,
      transactions: 1,
    }));

    const bytes = await informeAPdf({
      nomEspai: "Personal",
      des: "2020-01-01",
      fins: "2026-01-01",
      ingressos: "60000.00",
      despeses: "24000.00",
      net: "36000.00",
      mensual,
      categories,
    });

    expect(bytes.byteLength).toBeGreaterThan(3000);
  });
});
