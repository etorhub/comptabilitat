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

import { Taula } from "../src/routes/transactions/transactions.fragment.tsx";
import type { GrupCategories } from "../src/services/categories.ts";
import type { MovimentVista } from "../src/services/transactions.ts";
import { transactionFiltersSchema } from "../src/routes/transactions/transactions.schema.ts";

const grups: GrupCategories[] = [
  { etiqueta: "Alimentacio", opcions: [{ valor: 1, text: "Supermercat" }] },
  { etiqueta: "Transport", opcions: [{ valor: 2, text: "Benzina" }] },
];

function moviment(id: number): MovimentVista {
  return {
    id,
    bookingDate: "2026-02-10",
    valueDate: null,
    amount: "-30.00",
    currency: "EUR",
    status: "booked",
    description: `Compra ${id}`,
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
  };
}

async function taula(potEditar: boolean, quantes = 3): Promise<string> {
  const items = Array.from({ length: quantes }, (_, i) => moviment(i + 1));
  return String(
    await Taula({
      codi: "personal",
      pagina: { items, total: quantes, offset: 0, limit: 50, totalImport: "-90.00" },
      grups,
      filters: transactionFiltersSchema.parse({}),
      potEditar,
    }),
  );
}

/** Els `name=` que hi ha dins de cada `<form>` del marcatge. */
function campsPerFormulari(marcatge: string): string[][] {
  const formularis: string[][] = [];
  for (const tros of marcatge.split(/<form\b/i).slice(1)) {
    const cos = tros.split(/<\/form>/i)[0] ?? "";
    formularis.push([...cos.matchAll(/\sname="([^"]+)"/g)].map((m) => m[1] as string));
  }
  return formularis;
}

describe("la taula de moviments", () => {
  test("hi ha una tria de categoria per fila, mes la de la barra", async () => {
    // Aixo no comprova res per si sol: hi es perque les dues proves de sota
    // no puguin passar per no haver trobat res a mirar.
    const marcatge = await taula(true, 5);
    expect([...marcatge.matchAll(/name="category_id"/g)]).toHaveLength(6);
    expect([...marcatge.matchAll(/name="moviment"/g)]).toHaveLength(5);
  });

  test("cap formulari no duu dos cops el mateix camp", async () => {
    const formularis = campsPerFormulari(await taula(true, 5));
    for (const camps of formularis) {
      expect(new Set(camps).size).toBe(camps.length);
    }
  });

  test("les tries de categoria no comparteixen cap formulari", async () => {
    // Es el nus del problema: si totes son dins del mateix `<form>`, HTMX les
    // envia totes i l'ultima tapa la que has tocat.
    const marcatge = await taula(true, 5);
    for (const camps of campsPerFormulari(marcatge)) {
      expect(camps.filter((c) => c === "category_id").length).toBeLessThanOrEqual(1);
    }
    // I, de fet, aqui no hi ha d'haver cap formulari: la seleccio en bloc va
    // amb `hx-include`, que diu exactament que s'envia.
    expect(marcatge).not.toContain("<form");
  });

  test("cada tria de categoria te el seu propi identificador", async () => {
    const marcatge = await taula(true, 5);
    const ids = [...marcatge.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("la seleccio en bloc s'endu nomes el que toca", async () => {
    const marcatge = await taula(true, 3);
    expect(marcatge).toContain(
      `hx-include="#bloc-categoria, #taula-moviments input[name='moviment']:checked"`,
    );
  });

  test("qui nomes mira no veu ni caselles ni tries", async () => {
    const marcatge = await taula(false, 3);
    expect(marcatge).not.toContain('name="moviment"');
    expect(marcatge).not.toContain('name="category_id"');
  });
});
