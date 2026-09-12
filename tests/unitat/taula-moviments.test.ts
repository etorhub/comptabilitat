/**
 * L'estructura del formulari de la taula de moviments.
 *
 * Aquestes proves miren **el marcatge**, no la ruta, perque el problema que
 * eviten nomes existeix al navegador: si dues coses de la pagina comparteixen
 * el nom d'un camp i totes dues son dins del mateix `<form>`, HTMX les envia
 * totes en qualsevol peticio que no sigui `GET` —i, encara pitjor, les del
 * formulari **tapen** la de l'element que has tocat.
 *
 * Aixo va passar de debo: la tria de categoria de cada fila era dins del
 * formulari de la seleccio en bloc, aixi que canviar la categoria d'una fila
 * desava la de l'ultima fila de la pagina. Les proves de ruta no ho veien
 * perque envien el cos a ma i no fan mai el que fa el navegador.
 */

import { describe, expect, test } from "bun:test";

import { Table } from "../../src/routes/transactions/transactions.fragment.ts";
import type { CategoryGroup } from "../../src/services/categories.ts";
import type { TransactionView } from "../../src/services/transactions.ts";
import { transactionFiltersSchema } from "../../src/routes/transactions/transactions.schema.ts";

const groups: CategoryGroup[] = [
  { tag: "Alimentacio", options: [{ valor: 1, text: "Supermercat" }] },
  { tag: "Transport", options: [{ valor: 2, text: "Benzina" }] },
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
    tipusOperacio: "altres",
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
    serieId: null,
    serieLabel: null,
  };
}

async function table(potEditar: boolean, quantes = 3): Promise<string> {
  const items = Array.from({ length: quantes }, (_, i) => transaction(i + 1));
  return String(
    await Table({
      codi: "personal",
      page: { items, total: quantes, offset: 0, limit: 50, totalImport: "-90.00" },
      groups,
      filters: transactionFiltersSchema.parse({}),
      potEditar,
    }),
  );
}

/** Els `name=` que hi ha dins de cada `<form>` del marcatge. */
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
    // Aixo no comprova res per si sol: hi es perque les dues proves de sota
    // no puguin passar per no haver trobat res a mirar.
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
    // Es el nus del problema: si totes son dins del mateix `<form>`, HTMX les
    // envia totes i l'ultima tapa la que has tocat.
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
      // Un formulari de fila nomes te nova_etiqueta (+ etiqueta al treure).
      // La barra no te formulari: va amb hx-include.
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
      tipusOperacio: "targeta",
    };
    const markup = String(
      await Table({
        codi: "personal",
        page: {
          items: [ambTargeta],
          total: 1,
          offset: 0,
          limit: 50,
          totalImport: "-30.00",
        },
        groups,
        filters: transactionFiltersSchema.parse({}),
        potEditar: true,
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
      tipusOperacio: "transferencia",
      transferGroupId: null,
    };
    const markup = String(
      await Table({
        codi: "personal",
        page: {
          items: [transferencia],
          total: 1,
          offset: 0,
          limit: 50,
          totalImport: "-30.00",
        },
        groups,
        filters: transactionFiltersSchema.parse({}),
        potEditar: false,
      }),
    );
    expect(markup).toContain("transferència");
    expect(markup).not.toContain(">traspas<");
  });
});

/**
 * Les fitxes del telefon.
 *
 * Per sota de 40rem la taula es dibuixa com una fitxa per moviment: el capçal
 * desapareix i el nom de cada columna surt de la `data-etiqueta` de la cella.
 * Es a dir que **una cella sense `data-etiqueta` es un camp sense nom** al
 * telefon, i al navegador de l'escriptori no es veu gens. Per aixo es
 * comprova aqui i no a ull.
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
    // Nomes les files, no el capçal: els `<th>` ja diuen com es diuen.
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
