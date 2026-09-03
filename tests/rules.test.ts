/**
 * El motor de regles.
 *
 * Traduccio de la part de `backend/tests/test_classification.py` que mira les
 * regles. Aixo es logica pura: no cal base de dades per a la major part.
 */

import { describe, expect, test } from "bun:test";

import type { Rule } from "../src/db/schema/index.ts";
import {
  condicioEncaixa,
  condicioLlegible,
  condicionsDe,
  primeraQueEncaixa,
  reglaEncaixa,
  stripAccents,
  type Condicio,
  type MovimentAvaluable,
} from "../src/services/rules.ts";

const moviment: MovimentAvaluable = {
  ledgerId: 1,
  description: "COMPRA TARJ. MERCADONA BARCELONA",
  normalizedDescription: "MERCADONA",
  counterparty: "Mercadona S.A.",
  amount: "-45.20",
  bankTransactionCode: "PMNT/CCRD",
  accountId: 7,
};

const regla = (over: Partial<Rule> = {}): Rule =>
  ({
    id: 1,
    name: "Prova",
    ledgerId: 1,
    priority: 100,
    isActive: true,
    conditions: [{ field: "normalized_description", operator: "equals", value: "MERCADONA" }],
    setCategoryId: 10,
    setMerchantId: null,
    setTags: [],
    source: "user",
    createdById: null,
    matchCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Rule;

describe("comparacio de text", () => {
  test("no mira accents ni majuscules", () => {
    expect(stripAccents("Alimentació")).toBe("Alimentacio");
    const c: Condicio = { field: "counterparty", operator: "contains", value: "mercadóna" };
    expect(condicioEncaixa(c, moviment)).toBe(true);
  });

  test("«conté», «és igual a» i «comença per»", () => {
    expect(
      condicioEncaixa(
        { field: "description", operator: "contains", value: "MERCADONA" },
        moviment,
      ),
    ).toBe(true);
    expect(
      condicioEncaixa(
        { field: "normalized_description", operator: "equals", value: "MERCADONA" },
        moviment,
      ),
    ).toBe(true);
    // «és igual a» ho es del text sencer, no d'un tros.
    expect(
      condicioEncaixa(
        { field: "description", operator: "equals", value: "MERCADONA" },
        moviment,
      ),
    ).toBe(false);
    expect(
      condicioEncaixa(
        { field: "description", operator: "starts_with", value: "compra" },
        moviment,
      ),
    ).toBe(true);
  });

  test("les expressions regulars", () => {
    expect(
      condicioEncaixa(
        { field: "description", operator: "regex", value: "MERCA.*BARCELONA" },
        moviment,
      ),
    ).toBe(true);
  });

  test("una expressio regular trencada no peta: no encaixa i prou", () => {
    expect(
      condicioEncaixa({ field: "description", operator: "regex", value: "([" }, moviment),
    ).toBe(false);
  });
});

describe("comparacio d'imports", () => {
  test("compara com a numeros, no com a text", () => {
    // -45.20 es mes petit que -10: com a text, "-45.20" > "-10".
    expect(condicioEncaixa({ field: "amount", operator: "lt", value: "-10" }, moviment)).toBe(
      true,
    );
    expect(condicioEncaixa({ field: "amount", operator: "gt", value: "-10" }, moviment)).toBe(
      false,
    );
    expect(condicioEncaixa({ field: "amount", operator: "gt", value: "-100" }, moviment)).toBe(
      true,
    );
  });

  test("un valor que no es un numero no encaixa", () => {
    expect(
      condicioEncaixa({ field: "amount", operator: "gt", value: "molt" }, moviment),
    ).toBe(false);
  });
});

describe("una regla sencera", () => {
  test("totes les condicions s'han de complir", () => {
    const dues = regla({
      conditions: [
        { field: "normalized_description", operator: "equals", value: "MERCADONA" },
        { field: "amount", operator: "lt", value: "-100" },
      ],
    });
    expect(reglaEncaixa(dues, moviment)).toBe(false);
  });

  test("una regla aturada no encaixa mai", () => {
    expect(reglaEncaixa(regla({ isActive: false }), moviment)).toBe(false);
  });

  test("una regla sense condicions no encaixa mai", () => {
    expect(reglaEncaixa(regla({ conditions: [] }), moviment)).toBe(false);
  });

  test("una regla d'un altre espai no encaixa mai", () => {
    expect(reglaEncaixa(regla({ ledgerId: 2 }), moviment)).toBe(false);
  });

  test("les condicions mal formades s'ignoren", () => {
    const barrejada = regla({
      conditions: [
        { field: "inventat", operator: "equals", value: "X" },
        { field: "normalized_description", operator: "equals", value: "MERCADONA" },
      ],
    });
    // Nomes en queda una de valida, i encaixa.
    expect(condicionsDe(barrejada)).toHaveLength(1);
    expect(reglaEncaixa(barrejada, moviment)).toBe(true);
  });

  test("si no en queda cap de valida, no encaixa", () => {
    const dolenta = regla({ conditions: [{ field: "inventat", operator: "?", value: "X" }] });
    expect(reglaEncaixa(dolenta, moviment)).toBe(false);
  });

  test("les condicions que no son una llista no peten", () => {
    expect(condicionsDe({ conditions: "aixo no es una llista" } as never)).toEqual([]);
    expect(condicionsDe({ conditions: null } as never)).toEqual([]);
  });
});

describe("l'ordre de les regles", () => {
  test("la primera que encaixa guanya", () => {
    const primera = regla({ id: 1, priority: 10, setCategoryId: 100 });
    const segona = regla({ id: 2, priority: 20, setCategoryId: 200 });
    expect(primeraQueEncaixa([primera, segona], moviment)?.setCategoryId).toBe(100);
  });

  test("si no n'encaixa cap, no en torna cap", () => {
    const cap = regla({
      conditions: [{ field: "description", operator: "contains", value: "NO HI ES" }],
    });
    expect(primeraQueEncaixa([cap], moviment)).toBeNull();
  });
});

describe("com es llegeix una condicio", () => {
  test("surt en català, no amb els noms de la base de dades", () => {
    expect(
      condicioLlegible({ field: "description", operator: "contains", value: "MERCADONA" }),
    ).toBe("el concepte conté «MERCADONA»");
  });
});
