/**
 * The structure of the transaction table's form.
 *
 * These tests look at **the markup**, not at the route, because the problem
 * they prevent only exists in the browser: if two things on the page share a
 * field name and both are inside the same `<form>`, HTMX sends them all in
 * any request that is not a `GET` —and, worse still, the form's ones
 * **shadow** the one on the element you touched.
 *
 * This really happened: each row's category picker was inside the bulk
 * selection form, so changing one row's category saved the last row's. The
 * route tests did not see it because they send the body by hand and never do
 * what the browser does.
 */

import { describe, expect, test } from "bun:test";

import { Table } from "../../src/routes/transactions/transactions.fragment.ts";
import type { CategoryGroup } from "../../src/services/categories.ts";
import type { TransactionView } from "../../src/services/transactions.ts";
import { transactionFiltersSchema } from "../../src/routes/transactions/transactions.schema.ts";

const groups: CategoryGroup[] = [
  { tag: "Alimentacio", options: [{ value: 1, text: "Supermercat" }] },
  { tag: "Transport", options: [{ value: 2, text: "Benzina" }] },
];

function transaction(id: number): TransactionView {
  return {
    id,
    bookingDate: "2026-02-10",
    valueDate: null,
    amount: "-30.00",
    currency: "EUR",
    status: "booked",
    description: `Compra ${id}`,
    descriptionHint: null,
    darrers4: null,
    operationType: "altres",
    counterparty: "",
    merchantId: null,
    merchantName: null,
    categoryId: null,
    categoryName: null,
    categorySource: "none",
    categoryConfidence: null,
    needsReview: true,
    notes: "",
    tags: [],
    isExcluded: false,
    transferGroupId: null,
    accountId: 1,
    accountName: "Compte",
    isMasked: false,
    seriesId: null,
    seriesLabel: null,
  };
}

async function table(canEdit: boolean, quantes = 3): Promise<string> {
  const items = Array.from({ length: quantes }, (_, i) => transaction(i + 1));
  return String(
    await Table({
      code: "personal",
      page: { items, total: quantes, offset: 0, limit: 50, totalAmount: "-90.00" },
      groups,
      filters: transactionFiltersSchema.parse({}),
      canEdit,
    }),
  );
}

/** The `name=`s inside each `<form>` of the markup. */
function fieldsPerForm(markup: string): string[][] {
  const formularis: string[][] = [];
  for (const part of markup.split(/<form\b/i).slice(1)) {
    const body = part.split(/<\/form>/i)[0] ?? "";
    formularis.push([...body.matchAll(/\sname="([^"]+)"/g)].map((m) => m[1] as string));
  }
  return formularis;
}

describe("la taula de moviments", () => {
  test("hi ha una tria de categoria per fila, mes la de la barra", async () => {
    // This checks nothing on its own: it is here so that the two tests below
    // cannot pass by having found nothing to look at.
    const markup = await table(true, 5);
    expect([...markup.matchAll(/name="category_id"/g)]).toHaveLength(6);
    expect([...markup.matchAll(/name="moviment"/g)]).toHaveLength(5);
  });

  test("cap formulari no duu dos cops el mateix camp", async () => {
    const formularis = fieldsPerForm(await table(true, 5));
    for (const camps of formularis) {
      expect(new Set(camps).size).toBe(camps.length);
    }
  });

  test("les tries de categoria no comparteixen cap formulari", async () => {
    // This is the crux of it: if they are all inside the same `<form>`, HTMX
    // sends them all and the last one shadows the one you touched.
    const markup = await table(true, 5);
    for (const camps of fieldsPerForm(markup)) {
      expect(camps.filter((c) => c === "category_id").length).toBeLessThanOrEqual(1);
    }
  });

  test("el camp d'etiqueta de fila no comparteix formulari amb la barra", async () => {
    const markup = await table(true, 3);
    for (const camps of fieldsPerForm(markup)) {
      const teFila = camps.includes("nova_etiqueta");
      const teBarra = camps.includes("etiqueta_bloc") || camps.includes("category_id");
      // A row form only has nova_etiqueta (+ etiqueta when removing).
      // The bar has no form: it goes with hx-include.
      if (teFila) {
        expect(camps).not.toContain("category_id");
        expect(camps).not.toContain("etiqueta_bloc");
      }
      if (teBarra && camps.includes("category_id")) {
        expect(camps).not.toContain("nova_etiqueta");
      }
    }
    expect(markup).toContain('name="nova_etiqueta"');
    expect(markup).toContain('name="etiqueta_bloc"');
  });

  test("cada tria de categoria te el seu propi identificador", async () => {
    const markup = await table(true, 5);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("la seleccio en bloc s'endu nomes el que toca", async () => {
    const markup = await table(true, 3);
    expect(markup).toContain(
      `hx-include="#bloc-categoria, #taula-moviments input[name='moviment']:checked"`,
    );
    expect(markup).toContain(
      `hx-include="#bloc-etiqueta, #taula-moviments input[name='moviment']:checked"`,
    );
  });

  test("qui nomes mira no veu ni caselles ni tries", async () => {
    const markup = await table(false, 3);
    expect(markup).not.toContain('name="moviment"');
    expect(markup).not.toContain('name="category_id"');
    expect(markup).not.toContain('name="nova_etiqueta"');
  });

  test("el xip de targeta mostra els darrers 4 i mai el PAN", async () => {
    const ambTargeta: TransactionView = {
      ...transaction(9),
      description: "Amazon",
      descriptionHint: "COMPRA WWW.AMAZON, LUXEMBOURG",
      darrers4: "4017",
      operationType: "targeta",
    };
    const markup = String(
      await Table({
        code: "personal",
        page: {
          items: [ambTargeta],
          total: 1,
          offset: 0,
          limit: 50,
          totalAmount: "-30.00",
        },
        groups,
        filters: transactionFiltersSchema.parse({}),
        canEdit: true,
      }),
    );
    expect(markup).toContain('class="xip-targeta"');
    expect(markup).toContain("*4017");
    expect(markup).toContain("Targeta acabada en 4017");
    expect(markup).not.toContain("5489010385484017");
  });

  test("una transferencia mostra l'etiqueta sense ser traspas propi", async () => {
    const transferencia: TransactionView = {
      ...transaction(10),
      description: "María Lourdes Cortés Braña",
      operationType: "transferencia",
      transferGroupId: null,
    };
    const markup = String(
      await Table({
        code: "personal",
        page: {
          items: [transferencia],
          total: 1,
          offset: 0,
          limit: 50,
          totalAmount: "-30.00",
        },
        groups,
        filters: transactionFiltersSchema.parse({}),
        canEdit: false,
      }),
    );
    expect(markup).toContain("transferència");
    expect(markup).not.toContain(">traspas<");
  });
});

/**
 * The phone cards.
 *
 * Below 40rem the table is drawn as one card per transaction: the header
 * disappears and each column's name comes from the cell's `data-etiqueta`.
 * Which means **a cell without `data-etiqueta` is an unnamed field** on the
 * phone, and on a desktop browser it cannot be seen at all. That is why it is
 * checked here and not by eye.
 */
describe("la taula de moviments en fitxes", () => {
  test("la taula demana el dibuix en fitxes", async () => {
    expect(await table(true, 2)).toContain('class="dades taula-moviments taula-fitxes"');
  });

  test("cada cella duu el nom de la seva columna", async () => {
    const markup = await table(true, 2);

    for (const name of ["Tria", "Data", "Concepte", "Comerç", "Categoria", "Import"]) {
      expect(markup).toContain(`data-etiqueta="${name}"`);
    }
  });

  test("no hi ha cap cella sense nom", async () => {
    // Only the rows, not the header: the `<th>`s already say their names.
    const celles = [...(await table(true, 3)).matchAll(/<td\b[^>]*>/g)].map((m) => m[0]);

    expect(celles.length).toBeGreaterThan(0);
    for (const cella of celles) {
      expect(cella).toContain("data-etiqueta=");
    }
  });

  test("qui nomes mira te fitxa igualment, sense la cella de tria", async () => {
    const markup = await table(false, 2);

    expect(markup).toContain('data-etiqueta="Data"');
    expect(markup).not.toContain('data-etiqueta="Tria"');
  });
});
