/**
 * Filtre per tipus d'operacio i etiqueta de transferencia.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  merchants,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { BarraFiltres } from "../src/routes/transactions/transactions.fragment.tsx";
import {
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "../src/routes/transactions/transactions.schema.ts";
import { seedCategories } from "../src/services/seed.ts";
import { llistaMoviments } from "../src/services/transactions.ts";

let ledgerId = 0;
let accountId = 0;

const baseFiltre = {
  accountId: null as number | null,
  dataDes: null as string | null,
  dataFins: null as string | null,
  categoryIds: [] as number[],
  merchantId: null as number | null,
  cerca: "",
  etiqueta: null as string | null,
  tipusOperacio: [] as ("targeta" | "transferencia" | "bizum" | "rebut" | "altres")[],
  nomesRevisio: false,
  nomesSenseClassificar: false,
  incloTraspassos: true,
  limit: 50,
  offset: 0,
};

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const [espai] = await db
    .insert(ledgers)
    .values({
      code: "personal",
      name: "Personal",
      description: "",
      currency: "EUR",
      color: "#2563eb",
      overdraftThreshold: "0.00",
      position: 0,
      isActive: true,
      alertRecipients: [],
    })
    .returning();
  ledgerId = espai?.id ?? 0;
  await seedCategories(ledgerId);

  const [connexio] = await db
    .insert(bankConnections)
    .values({
      name: "P",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();
  const [compte] = await db
    .insert(accounts)
    .values({
      connectionId: connexio?.id ?? 0,
      ledgerId,
      ebAccountUid: "uid-tipus",
      name: "Compte",
      product: "",
      iban: "ES00",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  accountId = compte?.id ?? 0;

  const base = {
    accountId,
    ledgerId,
    source: "manual" as const,
    bookingDate: "2026-03-01",
    amount: "-10.00",
    currency: "EUR",
    status: "booked" as const,
    normalizedDescription: "X",
    counterparty: "",
    bankTransactionCode: "",
    merchantId: null,
    categoryId: null,
    categorySource: "none" as const,
    needsReview: false,
    notes: "",
    tags: [] as string[],
    isExcluded: false,
    raw: {},
  };

  await db.insert(transactions).values([
    {
      ...base,
      dedupKey: "card",
      description: "COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA",
      normalizedDescription: "MERCADONA",
    },
    {
      ...base,
      dedupKey: "wire",
      description: "TRANSFERENCIA IMMEDIATA A FAVOR DE Maria Lopez",
      normalizedDescription: "MARIA LOPEZ",
      amount: "-50.00",
    },
    {
      ...base,
      dedupKey: "bizum",
      description: "BIZUM ENVIADO A JOAN",
      normalizedDescription: "JOAN",
      amount: "-5.00",
    },
    {
      ...base,
      dedupKey: "recibo",
      description: "RECIBO AJUNTAMENT DE BARCELONA, concepto: IBI",
      normalizedDescription: "AJUNTAMENT",
      amount: "-100.00",
    },
    {
      ...base,
      dedupKey: "other",
      description: "LIQUIDACION INTERESES",
      normalizedDescription: "INTERESES",
      amount: "-1.00",
    },
  ]);
});

describe("filtre per tipus d'operacio", () => {
  test("nomes transferencies", async () => {
    const pagina = await llistaMoviments(ledgerId, {
      ...baseFiltre,
      tipusOperacio: ["transferencia"],
    });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.description).toBe("Maria Lopez");
    expect(pagina.items[0]?.tipusOperacio).toBe("transferencia");
  });

  test("targeta o bizum (OR)", async () => {
    const pagina = await llistaMoviments(ledgerId, {
      ...baseFiltre,
      tipusOperacio: ["targeta", "bizum"],
    });
    const descs = pagina.items.map((i) => i.description).sort();
    expect(descs).toEqual(["Joan", "Mercadona"]);
  });

  test("altres exclou targeta transferencia bizum i rebut", async () => {
    const pagina = await llistaMoviments(ledgerId, {
      ...baseFiltre,
      tipusOperacio: ["altres"],
    });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.description).toMatch(/Intereses|Liquidacion/i);
  });
});

describe("schema de filtres tipus", () => {
  test("accepta un sol valor o una llista", () => {
    expect(transactionFiltersSchema.parse({ tipus: "transferencia" }).tipus).toEqual([
      "transferencia",
    ]);
    expect(
      transactionFiltersSchema.parse({ tipus: ["targeta", "bizum", "targeta"] }).tipus,
    ).toEqual(["targeta", "bizum"]);
  });

  test("serialitza tipus repetits a la query", () => {
    const q = transactionFiltersToQuery(
      transactionFiltersSchema.parse({ tipus: ["targeta", "rebut"], pagina: 1 }),
    );
    expect(q).toContain("tipus=targeta");
    expect(q).toContain("tipus=rebut");
    expect(q).toContain("pagina=1");
  });

  test("la barra mostra els checkboxes de tipus", async () => {
    const html = String(
      await BarraFiltres({
        codi: "personal",
        filters: transactionFiltersSchema.parse({ tipus: "transferencia" }),
        comptes: [],
        grups: [],
      }),
    );
    expect(html).toContain('name="tipus"');
    expect(html).toContain('value="transferencia"');
    expect(html).toContain("checked");
    expect(html).toContain("Targeta");
  });
});
