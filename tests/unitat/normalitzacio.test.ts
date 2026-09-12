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
import cases from "../fixtures/normalitzacio.json";

interface Case {
  description: string;
  counterparty: string;
  expected: [string, string];
}

describe("behaves the same as the Python implementation", () => {
  test(`${(cases as Case[]).length} recorded concepts give the same`, () => {
    for (const testCase of cases as Case[]) {
      const got = normalizeDescription(testCase.description, testCase.counterparty);
      expect({ input: testCase.description, output: got }).toEqual({
        input: testCase.description,
        output: testCase.expected as [string, string],
      });
    }
  });
});

describe("what it does, explained", () => {
  test("removes the operation type prefix and the town after the comma", () => {
    const [key] = normalizeDescription("COMPRA TARJ. MERCADONA BARCELONA, BARCELONA");
    expect(key).toBe("MERCADONA BARCELONA");
  });

  test("operations with no merchant have a fixed name", () => {
    expect(normalizeDescription("REINTEGRO EN CAJERO 4B")[0]).toBe("REINTEGRO EFECTIU");
    expect(normalizeDescription("COMISION DE MANTENIMIENTO")[0]).toBe("COMISSIO BANCARIA");
    expect(normalizeDescription("TRASPASO A CUENTA")[0]).toBe("TRASPAS ENTRE COMPTES");
  });

  test("a commission at the end of a purchase is not the merchant", () => {
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

  test("an operation prefix with nothing after it is not a merchant", () => {
    expect(normalizeDescription("PAGO MOVIL EN")[0]).toBe("");
    expect(normalizeDescription("COMPRA")[0]).toBe("");
    expect(normalizeDescription("RECIBO")[0]).toBe("");
    expect(normalizeDescription("TRANSFERENCIA")[0]).toBe("");
  });

  test("the counterparty the bank gives outranks the free concept", () => {
    const [key] = normalizeDescription("COMPRA TARJ. QUALSEVOL COSA", "Mercadona S.A.");
    // The final dot goes, but the one inside the acronym stays: it is what the
    // Python does, and what is stored in `merchants.normalized_name`.
    expect(key).toBe("MERCADONA S.A");
  });

  test("removes cards, dates, IBANs and references", () => {
    const [key] = normalizeDescription(
      "COMPRA TARJ. 5402XXXXXXXX1234 LLIBRERIA 12/03/2026 REF: 99887766",
    );
    expect(key).toBe("LLIBRERIA");
  });

  test("never comes out blank if there was text", () => {
    const [key] = normalizeDescription("12/03/2026 987654321");
    expect(key.length).toBeGreaterThan(0);
  });

  test("the display name is readable", () => {
    expect(displayName("COMUNITAT DE PROPIETARIS")).toBe("Comunitat de Propietaris");
    expect(displayName("ENDESA ENERGIA SA")).toBe("Endesa Energia SA");
    // «Bar» is a word, not an acronym.
    expect(displayName("BAR CAN PEPE")).toBe("Bar Can Pepe");
  });

  test("strips the accents for the key", () => {
    expect(stripAccents("AIGÜES DE BARCELONA")).toBe("AIGUES DE BARCELONA");
    expect(normalizeDescription("FARMACIA NÚRIA")[0]).toBe("FARMACIA NURIA");
  });
});

describe("detectOperationType decides where the counterparty goes", () => {
  test("a transfer is one, a Bizum is not", () => {
    expect(detectOperationType("TRANSFERENCIA DE JOAN GARCIA PEREZ")).toBe("transferencia");
    expect(detectOperationType("TRANSF. A MARIA LOPEZ")).toBe("transferencia");
    expect(detectOperationType("BIZUM DE JOAN GARCIA")).toBe("bizum");
    expect(detectOperationType("ENVIO BIZUM A MARIA")).toBe("bizum");
  });

  test("purchases, direct debits and the rest are not transfers", () => {
    expect(detectOperationType("COMPRA TARJ. MERCADONA")).toBe("targeta");
    expect(detectOperationType("RECIBO NETFLIX")).toBe("rebut");
    expect(detectOperationType("ADEUDO POR DOMICILIACION DE ENDESA")).toBe("rebut");
    expect(detectOperationType("INGRESO EN EFECTIVO")).toBe("altres");
    expect(detectOperationType("TRASPASO A CALELLA")).toBe("altres");
  });
});
