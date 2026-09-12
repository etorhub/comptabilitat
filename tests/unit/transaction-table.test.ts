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
    last4: null,
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

async function table(canEdit: boolean, howMany = 3): Promise<string> {
  const items = Array.from({ length: howMany }, (_, i) => transaction(i + 1));
  return String(
    await Table({
      code: "personal",
      page: { items, total: howMany, offset: 0, limit: 50, totalAmount: "-90.00" },
      groups,
      filters: transactionFiltersSchema.parse({}),
      canEdit,
    }),
  );
}

/** The `name=`s inside each `<form>` of the markup. */
function fieldsPerForm(markup: string): string[][] {
  const forms: string[][] = [];
  for (const part of markup.split(/<form\b/i).slice(1)) {
    const body = part.split(/<\/form>/i)[0] ?? "";
    forms.push([...body.matchAll(/\sname="([^"]+)"/g)].map((m) => m[1] as string));
  }
  return forms;
}

describe("the transaction table", () => {
  test("there is one category picker per row, plus the bar's", async () => {
    // This checks nothing on its own: it is here so that the two tests below
    // cannot pass by having found nothing to look at.
    const markup = await table(true, 5);
    expect([...markup.matchAll(/name="category_id"/g)]).toHaveLength(6);
    expect([...markup.matchAll(/name="moviment"/g)]).toHaveLength(5);
  });

  test("no form carries the same field twice", async () => {
    const forms = fieldsPerForm(await table(true, 5));
    for (const fields of forms) {
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  test("the category pickers share no form", async () => {
    // This is the crux of it: if they are all inside the same `<form>`, HTMX
    // sends them all and the last one shadows the one you touched.
    const markup = await table(true, 5);
    for (const fields of fieldsPerForm(markup)) {
      expect(fields.filter((c) => c === "category_id").length).toBeLessThanOrEqual(1);
    }
  });

  test("the row's tag field shares no form with the bar", async () => {
    const markup = await table(true, 3);
    for (const fields of fieldsPerForm(markup)) {
      const hasRow = fields.includes("nova_etiqueta");
      const hasBar = fields.includes("etiqueta_bloc") || fields.includes("category_id");
      // A row form only has nova_etiqueta (+ etiqueta when removing).
      // The bar has no form: it goes with hx-include.
      if (hasRow) {
        expect(fields).not.toContain("category_id");
        expect(fields).not.toContain("etiqueta_bloc");
      }
      if (hasBar && fields.includes("category_id")) {
        expect(fields).not.toContain("nova_etiqueta");
      }
    }
    expect(markup).toContain('name="nova_etiqueta"');
    expect(markup).toContain('name="etiqueta_bloc"');
  });

  test("each category picker has its own id", async () => {
    const markup = await table(true, 5);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the bulk selection takes only what it should", async () => {
    const markup = await table(true, 3);
    expect(markup).toContain(
      `hx-include="#bloc-categoria, #taula-moviments input[name='moviment']:checked"`,
    );
    expect(markup).toContain(
      `hx-include="#bloc-etiqueta, #taula-moviments input[name='moviment']:checked"`,
    );
  });

  test("whoever only looks sees neither checkboxes nor pickers", async () => {
    const markup = await table(false, 3);
    expect(markup).not.toContain('name="moviment"');
    expect(markup).not.toContain('name="category_id"');
    expect(markup).not.toContain('name="nova_etiqueta"');
  });

  test("the card chip shows the last 4 and never the PAN", async () => {
    const withCard: TransactionView = {
      ...transaction(9),
      description: "Amazon",
      descriptionHint: "COMPRA WWW.AMAZON, LUXEMBOURG",
      last4: "4017",
      operationType: "targeta",
    };
    const markup = String(
      await Table({
        code: "personal",
        page: {
          items: [withCard],
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

  test("a transfer shows the label without being an own-account transfer", async () => {
    const transfer: TransactionView = {
      ...transaction(10),
      description: "María Lourdes Cortés Braña",
      operationType: "transferencia",
      transferGroupId: null,
    };
    const markup = String(
      await Table({
        code: "personal",
        page: {
          items: [transfer],
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
describe("the transaction table as cards", () => {
  test("the table asks to be drawn as cards", async () => {
    expect(await table(true, 2)).toContain('class="dades taula-moviments taula-fitxes"');
  });

  test("each cell carries its column's name", async () => {
    const markup = await table(true, 2);

    for (const name of ["Tria", "Data", "Concepte", "Comerç", "Categoria", "Import"]) {
      expect(markup).toContain(`data-etiqueta="${name}"`);
    }
  });

  test("there is no cell without a name", async () => {
    // Only the rows, not the header: the `<th>`s already say their names.
    const cells = [...(await table(true, 3)).matchAll(/<td\b[^>]*>/g)].map((m) => m[0]);

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell).toContain("data-etiqueta=");
    }
  });

  test("whoever only looks gets a card all the same, without the picker cell", async () => {
    const markup = await table(false, 2);

    expect(markup).toContain('data-etiqueta="Data"');
    expect(markup).not.toContain('data-etiqueta="Tria"');
  });
});
