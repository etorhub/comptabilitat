/**
 * Parsing of the concept for the UI.
 *
 * It does not look at the database: only that the bank's examples become
 * readable and that a PAN never reaches the title.
 */

import { describe, expect, test } from "bun:test";

import { parseDescription } from "../../src/services/concept.ts";

describe("parseDescription", () => {
  test("purchase with a masked TARJ.", () => {
    const r = parseDescription("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.title).toBe("App Estacioname");
    expect(r.last4).toBe("4017");
    expect(r.cleanedOriginal).not.toMatch(/\d{13,19}/);
    expect(r.cleanedOriginal).not.toContain("484017");
  });

  test("mobile payment with a place tail", () => {
    const r = parseDescription("PAGO MOVIL EN IMAKO SUSHI, CALELLA PALAFES, TARJ. :*900522");
    expect(r.title).toBe("Imako Sushi");
    expect(r.last4).toBe("0522");
  });

  test("pharmacy with TARJ.", () => {
    const r = parseDescription(
      "COMPRA INTERNET EN FARMACIA LUIS M, SEVILLA ES, TARJ. :*900522",
    );
    expect(r.title).toBe("Farmacia Luis M");
    expect(r.last4).toBe("0522");
  });

  test("Amazon with a full PAN and a commission: the PAN does not come out", () => {
    const r = parseDescription(
      "COMPRA WWW.AMAZON*QE6I19905, LUXEMBOURG, TARJETA 5489010385484017 , COMISION 0,00",
    );
    expect(r.title).toBe("Amazon");
    expect(r.last4).toBe("4017");
    expect(r.title).not.toContain("5489");
    expect(r.cleanedOriginal).not.toContain("5489010385484017");
    expect(r.cleanedOriginal).not.toMatch(/COMISI/i);
  });

  test("a transfer keeps accents and casing", () => {
    const r = parseDescription("TRANSFERENCIA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.title).toBe("María Lourdes Cortés Braña");
    expect(r.last4).toBeNull();
    expect(r.type).toBe("transferencia");
  });

  test("an immediate transfer removes the whole prefix", () => {
    const r = parseDescription("TRANSFERENCIA IMMEDIATA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.title).toBe("María Lourdes Cortés Braña");
    expect(r.type).toBe("transferencia");
    expect(r.title).not.toMatch(/FAVOR/i);
  });

  test("a direct debit with concepto: leaves what is human", () => {
    const r = parseDescription(
      "RECIBO AJUNTAMENT DE BARCELONA, concepto: IBI+TM2026-3T/RCAD:1162401DF3816C0006ES/Torre dels Pardals,0066, P0202 Q.IBI 95,25/Q.TM 6,51/07746",
    );
    expect(r.title).toBe("IBI+TM2026-3T · Torre dels Pardals");
    expect(r.last4).toBeNull();
    expect(r.type).toBe("rebut");
    expect(r.title).not.toContain("RCAD");
    expect(r.title).not.toContain("Q.IBI");
  });

  test("a purchase is of type card", () => {
    const r = parseDescription("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.type).toBe("targeta");
  });

  test("a bizum is of type bizum", () => {
    const r = parseDescription("BIZUM ENVIADO A JOAN GARCIA");
    expect(r.type).toBe("bizum");
  });

  test("unknown text is kept without a card", () => {
    const r = parseDescription("COSA ESTRANYA DEL BANC XYZ, TARJ. :*123456");
    expect(r.last4).toBe("3456");
    expect(r.title).not.toContain("123456");
    expect(r.title.length).toBeGreaterThan(0);
  });

  test("COMPRA TARJ. with no card digits", () => {
    const r = parseDescription("COMPRA TARJ. CLINICA DISCRETA");
    expect(r.title).toBe("Clinica Discreta");
    expect(r.last4).toBeNull();
  });

  test("PAN masked with X: 5402XXXXXXXX1234", () => {
    const r = parseDescription("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA");
    expect(r.title).toBe("Mercadona");
    expect(r.last4).toBe("1234");
    expect(r.title).not.toContain("5402");
  });
});
