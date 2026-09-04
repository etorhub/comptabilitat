/**
 * Parseig del concepte per a la UI.
 *
 * No mira la base de dades: nomes que els exemples del banc es tornin
 * llegibles i que un PAN no arribi mai al titol.
 */

import { describe, expect, test } from "bun:test";

import { parsejaConcepte } from "../src/services/concepte.ts";

describe("parsejaConcepte", () => {
  test("compra amb TARJ. emmascarada", () => {
    const r = parsejaConcepte("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.titol).toBe("App Estacioname");
    expect(r.darrers4).toBe("4017");
    expect(r.originalNetejat).not.toMatch(/\d{13,19}/);
    expect(r.originalNetejat).not.toContain("484017");
  });

  test("pagament mobil amb cua de lloc", () => {
    const r = parsejaConcepte("PAGO MOVIL EN IMAKO SUSHI, CALELLA PALAFES, TARJ. :*900522");
    expect(r.titol).toBe("Imako Sushi");
    expect(r.darrers4).toBe("0522");
  });

  test("farmacia amb TARJ.", () => {
    const r = parsejaConcepte("COMPRA INTERNET EN FARMACIA LUIS M, SEVILLA ES, TARJ. :*900522");
    expect(r.titol).toBe("Farmacia Luis M");
    expect(r.darrers4).toBe("0522");
  });

  test("Amazon amb PAN sencer i comissio: el PAN no surt", () => {
    const r = parsejaConcepte(
      "COMPRA WWW.AMAZON*QE6I19905, LUXEMBOURG, TARJETA 5489010385484017 , COMISION 0,00",
    );
    expect(r.titol).toBe("Amazon");
    expect(r.darrers4).toBe("4017");
    expect(r.titol).not.toContain("5489");
    expect(r.originalNetejat).not.toContain("5489010385484017");
    expect(r.originalNetejat).not.toMatch(/COMISI/i);
  });

  test("transferencia conserva accents i casing", () => {
    const r = parsejaConcepte("TRANSFERENCIA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.titol).toBe("María Lourdes Cortés Braña");
    expect(r.darrers4).toBeNull();
    expect(r.tipus).toBe("transferencia");
  });

  test("transferencia immediata treu el prefix sencer", () => {
    const r = parsejaConcepte("TRANSFERENCIA IMMEDIATA A FAVOR DE María Lourdes Cortés Braña");
    expect(r.titol).toBe("María Lourdes Cortés Braña");
    expect(r.tipus).toBe("transferencia");
    expect(r.titol).not.toMatch(/FAVOR/i);
  });

  test("rebut amb concepto: queda el que es huma", () => {
    const r = parsejaConcepte(
      "RECIBO AJUNTAMENT DE BARCELONA, concepto: IBI+TM2026-3T/RCAD:1162401DF3816C0006ES/Torre dels Pardals,0066, P0202 Q.IBI 95,25/Q.TM 6,51/07746",
    );
    expect(r.titol).toBe("IBI+TM2026-3T · Torre dels Pardals");
    expect(r.darrers4).toBeNull();
    expect(r.tipus).toBe("rebut");
    expect(r.titol).not.toContain("RCAD");
    expect(r.titol).not.toContain("Q.IBI");
  });

  test("compra es tipus targeta", () => {
    const r = parsejaConcepte("COMPRA INTERNET EN APP ESTACIONAME, LLANÑA ES, TARJ. :*484017");
    expect(r.tipus).toBe("targeta");
  });

  test("bizum es tipus bizum", () => {
    const r = parsejaConcepte("BIZUM ENVIADO A JOAN GARCIA");
    expect(r.tipus).toBe("bizum");
  });

  test("text desconegut es conserva sense targeta", () => {
    const r = parsejaConcepte("COSA ESTRANYA DEL BANC XYZ, TARJ. :*123456");
    expect(r.darrers4).toBe("3456");
    expect(r.titol).not.toContain("123456");
    expect(r.titol.length).toBeGreaterThan(0);
  });

  test("COMPRA TARJ. sense digits de targeta", () => {
    const r = parsejaConcepte("COMPRA TARJ. CLINICA DISCRETA");
    expect(r.titol).toBe("Clinica Discreta");
    expect(r.darrers4).toBeNull();
  });

  test("PAN emmascarat amb X: 5402XXXXXXXX1234", () => {
    const r = parsejaConcepte("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA");
    expect(r.titol).toBe("Mercadona");
    expect(r.darrers4).toBe("1234");
    expect(r.titol).not.toContain("5402");
  });
});
