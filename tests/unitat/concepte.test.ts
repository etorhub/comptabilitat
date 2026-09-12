/**
 * Parseig del concepte per a la UI.
 *
 * No mira la base de dades: nomes que els exemples del banc es tornin
 * llegibles i que un PAN no arribi mai al titol.
 */

import { describe, expect, test } from "bun:test";

import { parseDescription } from "../../src/services/concepte.ts";

describe("parsejaConcepte", () => {
  test("compra amb TARJ. emmascarada", () => {
    const r = parseDescription("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.title).toBe("App Estacioname");
    expect(r.darrers4).toBe("4017");
    expect(r.cleanedOriginal).not.toMatch(/\d{13,19}/);
    expect(r.cleanedOriginal).not.toContain("484017");
  });

  test("pagament mobil amb cua de lloc", () => {
    const r = parseDescription("PAGO MOVIL EN IMAKO SUSHI, CALELLA PALAFES, TARJ. :*900522");
    expect(r.title).toBe("Imako Sushi");
    expect(r.darrers4).toBe("0522");
  });

  test("farmacia amb TARJ.", () => {
    const r = parseDescription(
      "COMPRA INTERNET EN FARMACIA LUIS M, SEVILLA ES, TARJ. :*900522",
    );
    expect(r.title).toBe("Farmacia Luis M");
    expect(r.darrers4).toBe("0522");
  });

  test("Amazon amb PAN sencer i comissio: el PAN no surt", () => {
    const r = parseDescription(
      "COMPRA WWW.AMAZON*QE6I19905, LUXEMBOURG, TARJETA 5489010385484017 , COMISION 0,00",
    );
    expect(r.title).toBe("Amazon");
    expect(r.darrers4).toBe("4017");
    expect(r.title).not.toContain("5489");
    expect(r.cleanedOriginal).not.toContain("5489010385484017");
    expect(r.cleanedOriginal).not.toMatch(/COMISI/i);
  });

  test("transferencia conserva accents i casing", () => {
    const r = parseDescription("TRANSFERENCIA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.title).toBe("María Lourdes Cortés Braña");
    expect(r.darrers4).toBeNull();
    expect(r.type).toBe("transferencia");
  });

  test("transferencia immediata treu el prefix sencer", () => {
    const r = parseDescription("TRANSFERENCIA IMMEDIATA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.title).toBe("María Lourdes Cortés Braña");
    expect(r.type).toBe("transferencia");
    expect(r.title).not.toMatch(/FAVOR/i);
  });

  test("rebut amb concepto: queda el que es huma", () => {
    const r = parseDescription(
      "RECIBO AJUNTAMENT DE BARCELONA, concepto: IBI+TM2026-3T/RCAD:1162401DF3816C0006ES/Torre dels Pardals,0066, P0202 Q.IBI 95,25/Q.TM 6,51/07746",
    );
    expect(r.title).toBe("IBI+TM2026-3T · Torre dels Pardals");
    expect(r.darrers4).toBeNull();
    expect(r.type).toBe("rebut");
    expect(r.title).not.toContain("RCAD");
    expect(r.title).not.toContain("Q.IBI");
  });

  test("compra es tipus targeta", () => {
    const r = parseDescription("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.type).toBe("targeta");
  });

  test("bizum es tipus bizum", () => {
    const r = parseDescription("BIZUM ENVIADO A JOAN GARCIA");
    expect(r.type).toBe("bizum");
  });

  test("text desconegut es conserva sense targeta", () => {
    const r = parseDescription("COSA ESTRANYA DEL BANC XYZ, TARJ. :*123456");
    expect(r.darrers4).toBe("3456");
    expect(r.title).not.toContain("123456");
    expect(r.title.length).toBeGreaterThan(0);
  });

  test("COMPRA TARJ. sense digits de targeta", () => {
    const r = parseDescription("COMPRA TARJ. CLINICA DISCRETA");
    expect(r.title).toBe("Clinica Discreta");
    expect(r.darrers4).toBeNull();
  });

  test("PAN emmascarat amb X: 5402XXXXXXXX1234", () => {
    const r = parseDescription("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA");
    expect(r.title).toBe("Mercadona");
    expect(r.darrers4).toBe("1234");
    expect(r.title).not.toContain("5402");
  });
});
