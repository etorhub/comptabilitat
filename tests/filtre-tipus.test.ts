/**
 * Filtre per tipus d'operacio i etiqueta de transferencia.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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
import { hashPassword } from "../src/lib/auth.ts";
import { BarraFiltres } from "../src/routes/transactions/transactions.fragment.tsx";
import {
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "../src/routes/transactions/transactions.schema.ts";
import { seedCategories } from "../src/services/seed.ts";
import { llistaMoviments, targetesDisponibles } from "../src/services/transactions.ts";
import { app } from "../src/server.ts";

const CONTRASENYA = "provaprovaprova";

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
  targetes: [] as string[],
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
    const descs = pagina.items.map((i) => i.description).toSorted();
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

describe("filtre per targeta concreta", () => {
  test("nomes els moviments d'aquella targeta", async () => {
    const pagina = await llistaMoviments(ledgerId, {
      ...baseFiltre,
      targetes: ["1234"],
    });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.description).toBe("Mercadona");
  });

  test("cap targeta seleccionada no filtra res", async () => {
    const pagina = await llistaMoviments(ledgerId, { ...baseFiltre, targetes: [] });
    expect(pagina.items).toHaveLength(5);
  });

  test("targetesDisponibles retorna els darrers 4 digits usats al compte", async () => {
    const targetes = await targetesDisponibles(ledgerId, accountId);
    expect(targetes).toEqual(["1234"]);
  });

  test("targetesDisponibles no revela la targeta d'un moviment emmascarat", async () => {
    await db
      .update(transactions)
      .set({ displayDescription: "Despesa personal" })
      .where(eq(transactions.dedupKey, "card"));

    const targetes = await targetesDisponibles(ledgerId, accountId);
    expect(targetes).toEqual([]);
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

  test("targeta accepta nomes 4 digits", () => {
    expect(
      transactionFiltersSchema.parse({ targeta: ["1234", "abcd", "12345"] }).targeta,
    ).toEqual(["1234"]);
    expect(
      transactionFiltersSchema.parse({ targeta: ["1234", "5678", "1234"] }).targeta,
    ).toEqual(["1234", "5678"]);
  });

  test("serialitza targeta repetides a la query", () => {
    const q = transactionFiltersToQuery(
      transactionFiltersSchema.parse({ targeta: ["1234", "5678"] }),
    );
    expect(q).toContain("targeta=1234");
    expect(q).toContain("targeta=5678");
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

  test("la barra mostra els checkboxes de targeta quan n'hi ha", async () => {
    const html = String(
      await BarraFiltres({
        codi: "personal",
        filters: transactionFiltersSchema.parse({ targeta: "1234" }),
        comptes: [],
        grups: [],
        targetesConegudes: ["1234"],
      }),
    );
    expect(html).toContain('name="targeta"');
    expect(html).toContain('value="1234"');
    expect(html).toContain("checked");
  });

  test("sense targetes conegudes no hi ha fieldset", async () => {
    const html = String(
      await BarraFiltres({
        codi: "personal",
        filters: transactionFiltersSchema.parse({}),
        comptes: [],
        grups: [],
      }),
    );
    expect(html).not.toContain('name="targeta"');
  });
});

async function entra(email: string): Promise<string> {
  const getEntrada = await app.request("/entrada");
  const htmlEntrada = await getEntrada.text();
  const seedCookie = (getEntrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";
  const res = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
    body: new URLSearchParams({ _csrf: camp, email, password: CONTRASENYA }).toString(),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("ruta de moviments amb filtre tipus", () => {
  test("la pagina i el fragment no tornen el mateix, i el push guarda tipus", async () => {
    const [usuari] = await db
      .insert(users)
      .values({
        email: "filtre-tipus@exemple.cat",
        fullName: "Filtre",
        passwordHash: await hashPassword(CONTRASENYA),
        isActive: true,
        isAdmin: false,
      })
      .returning();
    await db.insert(userLedgerPermissions).values({
      userId: usuari?.id ?? 0,
      ledgerId,
      role: "editor",
    });
    const cookie = await entra("filtre-tipus@exemple.cat");

    const pagina = await app.request("/e/personal/moviments?tipus=transferencia", {
      headers: { Cookie: cookie },
    });
    const frag = await app.request("/e/personal/moviments/fragment/taula?tipus=transferencia", {
      headers: { Cookie: cookie },
    });
    expect(pagina.status).toBe(200);
    expect(frag.status).toBe(200);

    const htmlPagina = await pagina.text();
    const htmlFrag = await frag.text();
    expect(htmlPagina.toLowerCase()).toContain("<!doctype html");
    expect(htmlFrag.toLowerCase()).not.toContain("<!doctype html");
    expect(htmlPagina).toContain("filtre-tipus");
    expect(htmlPagina).toContain('name="tipus"');
    expect(htmlFrag).toContain("Maria Lopez");
    expect(htmlFrag).toContain("transferència");
    expect(htmlFrag).not.toContain("Mercadona");
    expect(frag.headers.get("HX-Push-Url")).toContain("tipus=transferencia");
    expect(htmlPagina).not.toBe(htmlFrag);
  });

  test("el fragment refresca el fieldset de targetes amb un swap OOB", async () => {
    const [usuari] = await db
      .insert(users)
      .values({
        email: "filtre-targeta@exemple.cat",
        fullName: "Filtre targeta",
        passwordHash: await hashPassword(CONTRASENYA),
        isActive: true,
        isAdmin: false,
      })
      .returning();
    await db.insert(userLedgerPermissions).values({
      userId: usuari?.id ?? 0,
      ledgerId,
      role: "editor",
    });
    const cookie = await entra("filtre-targeta@exemple.cat");

    const frag = await app.request("/e/personal/moviments/fragment/taula?targeta=1234", {
      headers: { Cookie: cookie },
    });
    expect(frag.status).toBe(200);
    const htmlFrag = await frag.text();
    expect(htmlFrag).toContain('id="filtre-targetes"');
    expect(htmlFrag).toContain('hx-swap-oob="true"');
    expect(htmlFrag).toContain('name="targeta"');
    expect(htmlFrag).toContain('value="1234"');
    expect(htmlFrag).toContain("Mercadona");
  });
});
