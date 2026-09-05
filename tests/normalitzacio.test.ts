/**
 * Normalitzacio dels conceptes bancaris.
 *
 * Aquesta funcio decideix la clau de la memoria de comerços
 * (`merchants.normalized_name`), i a la base de dades ja n'hi ha de desades.
 * Si el port canviés el resultat, els comerços que ja hi ha deixarien de
 * trobar-se amb ells mateixos i tot es tornaria a preguntar al model, en
 * silenci.
 *
 * Per aixo les expectatives del fitxer de dades **son la sortida de debò de
 * `backend/app/services/normalization.py`**, gravada tal com era. Aixo no
 * comprova que la funcio sigui bona: comprova que sigui **la mateixa**.
 */

import { describe, expect, test } from "bun:test";

import {
  detectaTipusOperacio,
  displayName,
  normalizeActorName,
  normalizeDescription,
  stripAccents,
} from "../src/services/normalization.ts";
import casos from "./fixtures/normalitzacio.json";

interface Cas {
  description: string;
  counterparty: string;
  expected: [string, string];
}

describe("es comporta igual que la implementacio de Python", () => {
  test(`${(casos as Cas[]).length} conceptes gravats donen el mateix`, () => {
    for (const cas of casos as Cas[]) {
      const obtingut = normalizeDescription(cas.description, cas.counterparty);
      expect({ entrada: cas.description, sortida: obtingut }).toEqual({
        entrada: cas.description,
        sortida: cas.expected as [string, string],
      });
    }
  });
});

describe("el que fa, explicat", () => {
  test("treu el prefix del tipus d'operacio i la poblacio de despres de la coma", () => {
    const [clau] = normalizeDescription("COMPRA TARJ. MERCADONA BARCELONA, BARCELONA");
    expect(clau).toBe("MERCADONA BARCELONA");
  });

  test("les operacions sense comerç tenen un nom fix", () => {
    expect(normalizeDescription("REINTEGRO EN CAJERO 4B")[0]).toBe("REINTEGRO EFECTIU");
    expect(normalizeDescription("COMISION DE MANTENIMIENTO")[0]).toBe("COMISSIO BANCARIA");
    expect(normalizeDescription("TRASPASO A CUENTA")[0]).toBe("TRASPAS ENTRE COMPTES");
  });

  test("una comissio al final d'una compra no es el comerç", () => {
    // El Santander afegeix «COMISION 0,00» a moltes compres; abans tot
    // queia al cubell COMISSIO BANCARIA.
    const [clau] = normalizeDescription(
      "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
    );
    expect(clau).toBe("SPOTIFY");
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
    const [clau] = normalizeDescription("COMPRA TARJ. QUALSEVOL COSA", "Mercadona S.A.");
    // El punt final se'n va, pero el de dins de la sigla es queda: es el que
    // fa el Python, i el que hi ha desat a `merchants.normalized_name`.
    expect(clau).toBe("MERCADONA S.A");
  });

  test("treu targetes, dates, IBAN i referencies", () => {
    const [clau] = normalizeDescription(
      "COMPRA TARJ. 5402XXXXXXXX1234 LLIBRERIA 12/03/2026 REF: 99887766",
    );
    expect(clau).toBe("LLIBRERIA");
  });

  test("no es queda mai en blanc si hi havia text", () => {
    const [clau] = normalizeDescription("12/03/2026 987654321");
    expect(clau.length).toBeGreaterThan(0);
  });

  test("el nom per mostrar es llegible", () => {
    expect(displayName("COMUNITAT DE PROPIETARIS")).toBe("Comunitat de Propietaris");
    expect(displayName("ENDESA ENERGIA SA")).toBe("Endesa Energia SA");
    // «Bar» es una paraula, no una sigla.
    expect(displayName("BAR CAN PEPE")).toBe("Bar Can Pepe");
  });

  test("treu els accents per a la clau", () => {
    expect(stripAccents("AIGÜES DE BARCELONA")).toBe("AIGUES DE BARCELONA");
    expect(normalizeDescription("FARMACIA NÚRIA")[0]).toBe("FARMACIA NURIA");
  });
});

describe("detectaTipusOperacio decideix on va la contrapart", () => {
  test("una transferencia ho es, un Bizum no", () => {
    expect(detectaTipusOperacio("TRANSFERENCIA DE JOAN GARCIA PEREZ")).toBe("transferencia");
    expect(detectaTipusOperacio("TRANSF. A MARIA LOPEZ")).toBe("transferencia");
    expect(detectaTipusOperacio("BIZUM DE JOAN GARCIA")).toBe("bizum");
    expect(detectaTipusOperacio("ENVIO BIZUM A MARIA")).toBe("bizum");
  });

  test("compres, rebuts i la resta no son transferencia", () => {
    expect(detectaTipusOperacio("COMPRA TARJ. MERCADONA")).toBe("targeta");
    expect(detectaTipusOperacio("RECIBO NETFLIX")).toBe("rebut");
    expect(detectaTipusOperacio("ADEUDO POR DOMICILIACION DE ENDESA")).toBe("rebut");
    expect(detectaTipusOperacio("INGRESO EN EFECTIVO")).toBe("altres");
    expect(detectaTipusOperacio("TRASPASO A CALELLA")).toBe("altres");
  });
});

describe("normalizeActorName", () => {
  test("treu el prefix de transferencia i deixa el nom de la persona", () => {
    const [clau, mostrar] = normalizeActorName("TRANSFERENCIA DE JOAN GARCIA PEREZ");
    expect(clau).toBe("JOAN GARCIA PEREZ");
    expect(mostrar).toBe("Joan Garcia Perez");
  });

  test("la contrapart del banc mana per sobre del concepte lliure", () => {
    const [clau] = normalizeActorName("TRANSFERENCIA A FAVOR DE X", "Maria Garcia Lopez");
    expect(clau).toBe("MARIA GARCIA LOPEZ");
  });

  test("talla a 8 tokens, no a 6: un nom i cognoms complets hi caben", () => {
    const [clau] = normalizeActorName(
      "TRANSFERENCIA DE JOAN CARLES GARCIA MARTINEZ LOPEZ FERNANDEZ SUAREZ TORRES",
    );
    expect(clau.split(" ")).toHaveLength(8);
  });

  test("neteja IBAN i referencies com el nom de comerç", () => {
    const [clau] = normalizeActorName(
      "TRANSFERENCIA DE JOAN GARCIA REF: 99887766 ES9121000418450200051332",
    );
    expect(clau).toBe("JOAN GARCIA");
  });

  test("sense text no dona cap actor", () => {
    expect(normalizeActorName("")[0]).toBe("");
  });
});
