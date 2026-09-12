/**
 * Normalization of the bank concepts.
 *
 * This function decides the key of the merchant memory
 * (`merchants.normalized_name`), and there are already some stored in the
 * database. If the port changed the result, the merchants already there would
 * stop finding themselves and everything would be asked of the model again,
 * in silence.
 *
 * That is why the expectations in the data file **are the real output of
 * `backend/app/services/normalization.py`**, recorded as it was. This does not
 * check that the function is good: it checks that it is **the same**.
 */

import { describe, expect, test } from "bun:test";

import {
  detectOperationType,
  displayName,
  normalizeDescription,
  stripAccents,
} from "../../src/services/normalization.ts";
import casos from "../fixtures/normalitzacio.json";

interface Cas {
  description: string;
  counterparty: string;
  expected: [string, string];
}

describe("es comporta igual que la implementacio de Python", () => {
  test(`${(casos as Cas[]).length} conceptes gravats donen el mateix`, () => {
    for (const cas of casos as Cas[]) {
      const obtingut = normalizeDescription(cas.description, cas.counterparty);
      expect({ login: cas.description, output: obtingut }).toEqual({
        login: cas.description,
        output: cas.expected as [string, string],
      });
    }
  });
});

describe("el que fa, explicat", () => {
  test("treu el prefix del tipus d'operacio i la poblacio de despres de la coma", () => {
    const [key] = normalizeDescription("COMPRA TARJ. MERCADONA BARCELONA, BARCELONA");
    expect(key).toBe("MERCADONA BARCELONA");
  });

  test("les operacions sense comerç tenen un nom fix", () => {
    expect(normalizeDescription("REINTEGRO EN CAJERO 4B")[0]).toBe("REINTEGRO EFECTIU");
    expect(normalizeDescription("COMISION DE MANTENIMIENTO")[0]).toBe("COMISSIO BANCARIA");
    expect(normalizeDescription("TRASPASO A CUENTA")[0]).toBe("TRASPAS ENTRE COMPTES");
  });

  test("una comissio al final d'una compra no es el comerç", () => {
    // Santander adds «COMISION 0,00» to many purchases; before, they all fell
    // into the COMISSIO BANCARIA bucket.
    const [key] = normalizeDescription(
      "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
    );
    expect(key).toBe("SPOTIFY");
    expect(normalizeDescription("PAGO MOVIL EN BAR CAN PEPE, COMISION 0,00")[0]).toBe(
      "BAR CAN PEPE",
    );
  });

  test("un prefix d'operacio sense resta no es un comerç", () => {
    expect(normalizeDescription("PAGO MOVIL EN")[0]).toBe("");
    expect(normalizeDescription("COMPRA")[0]).toBe("");
    expect(normalizeDescription("RECIBO")[0]).toBe("");
    expect(normalizeDescription("TRANSFERENCIA")[0]).toBe("");
  });

  test("la contrapart que dona el banc mana sobre el concepte lliure", () => {
    const [key] = normalizeDescription("COMPRA TARJ. QUALSEVOL COSA", "Mercadona S.A.");
    // The final dot goes, but the one inside the acronym stays: it is what the
    // Python does, and what is stored in `merchants.normalized_name`.
    expect(key).toBe("MERCADONA S.A");
  });

  test("treu targetes, dates, IBAN i referencies", () => {
    const [key] = normalizeDescription(
      "COMPRA TARJ. 5402XXXXXXXX1234 LLIBRERIA 12/03/2026 REF: 99887766",
    );
    expect(key).toBe("LLIBRERIA");
  });

  test("no es queda mai en blanc si hi havia text", () => {
    const [key] = normalizeDescription("12/03/2026 987654321");
    expect(key.length).toBeGreaterThan(0);
  });

  test("el nom per mostrar es llegible", () => {
    expect(displayName("COMUNITAT DE PROPIETARIS")).toBe("Comunitat de Propietaris");
    expect(displayName("ENDESA ENERGIA SA")).toBe("Endesa Energia SA");
    // «Bar» is a word, not an acronym.
    expect(displayName("BAR CAN PEPE")).toBe("Bar Can Pepe");
  });

  test("treu els accents per a la clau", () => {
    expect(stripAccents("AIGÜES DE BARCELONA")).toBe("AIGUES DE BARCELONA");
    expect(normalizeDescription("FARMACIA NÚRIA")[0]).toBe("FARMACIA NURIA");
  });
});

describe("detectaTipusOperacio decideix on va la contrapart", () => {
  test("una transferencia ho es, un Bizum no", () => {
    expect(detectOperationType("TRANSFERENCIA DE JOAN GARCIA PEREZ")).toBe("transferencia");
    expect(detectOperationType("TRANSF. A MARIA LOPEZ")).toBe("transferencia");
    expect(detectOperationType("BIZUM DE JOAN GARCIA")).toBe("bizum");
    expect(detectOperationType("ENVIO BIZUM A MARIA")).toBe("bizum");
  });

  test("compres, rebuts i la resta no son transferencia", () => {
    expect(detectOperationType("COMPRA TARJ. MERCADONA")).toBe("targeta");
    expect(detectOperationType("RECIBO NETFLIX")).toBe("rebut");
    expect(detectOperationType("ADEUDO POR DOMICILIACION DE ENDESA")).toBe("rebut");
    expect(detectOperationType("INGRESO EN EFECTIVO")).toBe("altres");
    expect(detectOperationType("TRASPASO A CALELLA")).toBe("altres");
  });
});
