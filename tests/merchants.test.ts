/**
 * Comerços: la memoria de cada espai.
 *
 * La invariant que es comprova aqui es la mes important de tota la
 * classificacio: **el que ha decidit una persona no ho sobreescriu res**.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringOccurrences,
  recurringSeries,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { AppError, NotFoundError } from "../src/lib/http.ts";
import { addDays, todayLocal } from "../src/lib/time.ts";
import {
  assignaCategoria,
  llistaComercos,
  obteOCreaComerc,
  reassignaNormalitzacio,
} from "../src/services/merchants.ts";
import {
  comprovaRebutsQueFalten,
  declaraComercRecurrent,
  detectaRecurrents,
} from "../src/services/recurring.ts";
import { llistaSeries } from "../src/services/recurring-list.ts";
import { seedCategories } from "../src/services/seed.ts";
import { app } from "../src/server.ts";

const CONTRASENYA = "provaprovaprova";

let ledgerId = 0;
let altreLedgerId = 0;
let accountId = 0;
let merchantId = 0;
let sessio = { cookie: "", csrf: "" };

async function categoriaPerSlug(slug: string, ledger = ledgerId) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledger), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta ${slug}`);
  return c;
}

async function moviment(dedupKey: string, source: "user" | "none", categoryId: number | null) {
  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey,
    source: "manual",
    bookingDate: "2026-02-01",
    amount: "-9.00",
    currency: "EUR",
    status: "booked",
    description: "Cafe",
    normalizedDescription: "BAR PEPE",
    counterparty: "Bar Pepe",
    bankTransactionCode: "",
    merchantId,
    categoryId,
    categorySource: source,
    needsReview: source === "none",
    notes: "",
    tags: [],
    isExcluded: false,
    raw: {},
  });
}

beforeEach(async () => {
  await db.delete(recurringOccurrences);
  await db.delete(recurringSeries);
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const espais = await db
    .insert(ledgers)
    .values(
      ["personal", "calella"].map((code, i) => ({
        code,
        name: code,
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: i,
        isActive: true,
        alertRecipients: [],
      })),
    )
    .returning();
  ledgerId = espais.find((e) => e.code === "personal")?.id ?? 0;
  altreLedgerId = espais.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(ledgerId);
  await seedCategories(altreLedgerId);

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
      ebAccountUid: "uid-m",
      name: "C",
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

  const [comerc] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: "BAR PEPE",
      displayName: "Bar Pepe",
      defaultCategoryId: null,
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      lastSeenAt: null,
    })
    .returning();
  merchantId = comerc?.id ?? 0;

  const [usuari] = await db
    .insert(users)
    .values({
      email: "editor@exemple.cat",
      fullName: "Editor",
      passwordHash: await hashPassword(CONTRASENYA),
      isActive: true,
      // Comerços penja d'`ambAdmin`: cal ser administrador de la instal·lacio.
      isAdmin: true,
    })
    .returning();
  await db.insert(userLedgerPermissions).values({
    userId: usuari?.id ?? 0,
    ledgerId,
    role: "editor",
  });
  sessio = await entra("editor@exemple.cat");
});

async function entra(email: string): Promise<{ cookie: string; csrf: string }> {
  const getEntrada = await app.request("/entrada");
  const htmlEntrada = await getEntrada.text();
  const seedCookie = (getEntrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";

  const res = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
    body: new URLSearchParams({ _csrf: camp, email, password: CONTRASENYA }).toString(),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const pagina = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const csrf = /X-CSRF-Token": "([^"]+)"/.exec(await pagina.text())?.[1] ?? "";
  return { cookie, csrf };
}
describe("assignar la categoria d'un comerç", () => {
  test("no toca mai el que ha classificat una persona", async () => {
    const restaurants = await categoriaPerSlug("restauracio-restaurants");
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");

    await moviment("meu", "user", restaurants.id);
    await moviment("automatic-1", "none", null);
    await moviment("automatic-2", "none", null);

    const canviats = await assignaCategoria(merchantId, ledgerId, bars.id);
    expect(canviats).toBe(2);

    const [meu] = await db.select().from(transactions).where(eq(transactions.dedupKey, "meu"));
    // Ni la categoria ni l'origen: la decisio de la persona mana.
    expect(meu?.categoryId).toBe(restaurants.id);
    expect(meu?.categorySource).toBe("user");

    const automatics = await db
      .select()
      .from(transactions)
      .where(eq(transactions.categorySource, "merchant"));
    expect(automatics).toHaveLength(2);
    expect(automatics.every((t) => t.categoryId === bars.id)).toBe(true);
    // I surten de la safata de revisio.
    expect(automatics.every((t) => t.needsReview === false)).toBe(true);
  });

  test("deixa el comerç confirmat", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await assignaCategoria(merchantId, ledgerId, bars.id);

    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(comerc?.isConfirmed).toBe(true);
    expect(comerc?.categorySource).toBe("user");
    expect(comerc?.defaultCategoryId).toBe(bars.id);
  });

  test("es pot demanar que no s'apliqui als que ja hi ha", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await moviment("automatic-1", "none", null);

    const canviats = await assignaCategoria(merchantId, ledgerId, bars.id, false);
    expect(canviats).toBe(0);

    const [t] = await db.select().from(transactions);
    expect(t?.categoryId).toBeNull();
  });

  test("no accepta una categoria d'un altre espai", async () => {
    const forana = await categoriaPerSlug("habitatge", altreLedgerId);
    await expect(assignaCategoria(merchantId, ledgerId, forana.id)).rejects.toThrow(AppError);
  });

  test("no accepta un comerç d'un altre espai", async () => {
    const [foraster] = await db
      .insert(merchants)
      .values({
        ledgerId: altreLedgerId,
        normalizedName: "ALTRE",
        displayName: "Altre",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();

    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await expect(assignaCategoria(foraster?.id ?? 0, ledgerId, bars.id)).rejects.toThrow();
  });
});

describe("obtenir o crear un comerç", () => {
  test("no en crea cap amb el nom buit", async () => {
    expect(await obteOCreaComerc(ledgerId, "   ")).toBeNull();
  });

  test("el mateix nom a dos espais son dos comerços diferents", async () => {
    const a = await obteOCreaComerc(ledgerId, "MERCADONA");
    const b = await obteOCreaComerc(altreLedgerId, "MERCADONA");

    expect(a?.id).not.toBe(b?.id);
    expect(a?.ledgerId).toBe(ledgerId);
    expect(b?.ledgerId).toBe(altreLedgerId);
  });

  test("compta les vegades i recorda l'ultima data", async () => {
    await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-01-10");
    const segon = await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-03-20");

    expect(segon?.transactionCount).toBe(2);
    expect(segon?.lastSeenAt).toBe("2026-03-20");

    // Una data anterior no fa recular l'ultima vista.
    const tercer = await obteOCreaComerc(ledgerId, "NOU", "Nou", "2026-02-01");
    expect(tercer?.lastSeenAt).toBe("2026-03-20");
  });
});

describe("la llista", () => {
  test("nomes ensenya els comerços d'aquest espai", async () => {
    await obteOCreaComerc(altreLedgerId, "FORASTER");
    const pagina = await llistaComercos(ledgerId, {
      cerca: "",
      nomesSenseClassificar: false,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.items.every((m) => m.normalizedName !== "FORASTER")).toBe(true);
  });

  test("la cerca mira el nom normalitzat i el que es veu", async () => {
    const pagina = await llistaComercos(ledgerId, {
      cerca: "pepe",
      nomesSenseClassificar: false,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.total).toBe(1);
    expect(pagina.items[0]?.displayName).toBe("Bar Pepe");
  });

  test("es poden demanar nomes els que no tenen categoria", async () => {
    const bars = await categoriaPerSlug("restauracio-bars-i-cafeteries");
    await obteOCreaComerc(ledgerId, "SENSE");
    await assignaCategoria(merchantId, ledgerId, bars.id);

    const pagina = await llistaComercos(ledgerId, {
      cerca: "",
      nomesSenseClassificar: true,
      nomesSenseConfirmar: false,
      limit: 50,
      offset: 0,
    });
    expect(pagina.items.every((m) => m.defaultCategoryId === null)).toBe(true);
    expect(pagina.items.some((m) => m.normalizedName === "SENSE")).toBe(true);
  });
});

describe("reassignar la normalitzacio", () => {
  test("treu una compra Spotify del cubell COMISSIO BANCARIA", async () => {
    const [cubell] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "COMISSIO BANCARIA",
        displayName: "Comissio Bancaria",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 1,
        lastSeenAt: null,
      })
      .returning();

    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "spotify-mal",
      source: "enablebanking",
      bookingDate: "2026-03-01",
      amount: "-10.99",
      currency: "EUR",
      status: "booked",
      description:
        "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
      normalizedDescription: "COMISSIO BANCARIA",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: cubell?.id ?? 0,
      categoryId: null,
      categorySource: "merchant",
      needsReview: true,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    const resultat = await reassignaNormalitzacio(ledgerId);
    expect(resultat.canviats).toBeGreaterThanOrEqual(1);

    const [t] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.dedupKey, "spotify-mal"));
    expect(t?.normalizedDescription).toBe("SPOTIFY");

    const [spotify] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.ledgerId, ledgerId), eq(merchants.normalizedName, "SPOTIFY")));
    expect(spotify).toBeDefined();
    expect(t?.merchantId).toBe(spotify?.id);

    const [cubellDespres] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, cubell?.id ?? 0));
    expect(cubellDespres?.transactionCount).toBe(0);
    expect(spotify?.transactionCount).toBe(1);
  });

  test("no toca la categoria que ha posat una persona", async () => {
    const restaurants = await categoriaPerSlug("restauracio-restaurants");
    const [cubell] = await db
      .insert(merchants)
      .values({
        ledgerId,
        normalizedName: "COMISSIO BANCARIA",
        displayName: "Comissio Bancaria",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 1,
        lastSeenAt: null,
      })
      .returning();

    await db.insert(transactions).values({
      accountId,
      ledgerId,
      dedupKey: "user-spotify",
      source: "enablebanking",
      bookingDate: "2026-03-01",
      amount: "-10.99",
      currency: "EUR",
      status: "booked",
      description:
        "COMPRA Spotify P45ED4AF0B, Stockholm, TARJETA 5489010385484017 , COMISION 0,00",
      normalizedDescription: "COMISSIO BANCARIA",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: cubell?.id ?? 0,
      categoryId: restaurants.id,
      categorySource: "user",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });

    await reassignaNormalitzacio(ledgerId);

    const [t] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.dedupKey, "user-spotify"));
    expect(t?.normalizedDescription).toBe("SPOTIFY");
    expect(t?.categoryId).toBe(restaurants.id);
    expect(t?.categorySource).toBe("user");
  });
});

describe("marcar un comerç com a recurrent", () => {
  test("crea una serie amb un sol moviment irregular", async () => {
    await moviment("lloguer", "none", null);
    await db
      .update(transactions)
      .set({ amount: "-850.00", bookingDate: addDays(todayLocal(), -40) })
      .where(eq(transactions.dedupKey, "lloguer"));

    const resultat = await declaraComercRecurrent(merchantId, ledgerId, {
      recurrent: true,
      cadence: "monthly",
    });
    expect(resultat.isSubscription).toBe(true);

    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(comerc?.isRecurrent).toBe(true);
    expect(comerc?.recurrentCadence).toBe("monthly");

    const series = await llistaSeries(ledgerId, false, false);
    expect(series).toHaveLength(1);
    expect(series[0]?.expectedAmount).toBe("-850.00");
    expect(series[0]?.includeInForecast).toBe(true);
    expect(series[0]?.isDeclared).toBe(true);
    expect(series[0]?.cadence).toBe("monthly");
  });

  test("desmarcar acaba la serie i la treu de la previsio", async () => {
    await moviment("asseg", "none", null);
    await db
      .update(transactions)
      .set({ amount: "-320.00", bookingDate: addDays(todayLocal(), -10) })
      .where(eq(transactions.dedupKey, "asseg"));

    await declaraComercRecurrent(merchantId, ledgerId, {
      recurrent: true,
      cadence: "annual",
    });
    await declaraComercRecurrent(merchantId, ledgerId, {
      recurrent: false,
      cadence: null,
    });

    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(comerc?.isRecurrent).toBe(false);
    expect(comerc?.recurrentCadence).toBeNull();

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    expect(serie?.status).toBe("ended");
    expect(serie?.includeInForecast).toBe(false);
  });

  test("404 si el comerç es d'un altre espai", async () => {
    await expect(
      declaraComercRecurrent(merchantId, altreLedgerId, {
        recurrent: true,
        cadence: "monthly",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("422 si no hi ha moviments per projectar", async () => {
    await expect(
      declaraComercRecurrent(merchantId, ledgerId, {
        recurrent: true,
        cadence: "monthly",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("el detector no acaba una serie declarada encara que el rebut falti", async () => {
    await moviment("neteja", "none", null);
    await db
      .update(transactions)
      .set({ amount: "-40.00", bookingDate: addDays(todayLocal(), -100) })
      .where(eq(transactions.dedupKey, "neteja"));

    await declaraComercRecurrent(merchantId, ledgerId, {
      recurrent: true,
      cadence: "monthly",
    });

    // Força una data prevista molt antiga perque el detector la donaria per acabada.
    await db
      .update(recurringSeries)
      .set({ nextExpectedDate: addDays(todayLocal(), -60), intervalDays: 30 })
      .where(eq(recurringSeries.ledgerId, ledgerId));

    await comprovaRebutsQueFalten(ledgerId);

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    expect(serie?.status).toBe("active");
  });

  test("dues aparicions irregulars creen serie si el comerç es declarat", async () => {
    const avui = todayLocal();
    await moviment("a", "none", null);
    await moviment("b", "none", null);
    await db
      .update(transactions)
      .set({ amount: "-55.00", bookingDate: addDays(avui, -100) })
      .where(eq(transactions.dedupKey, "a"));
    await db
      .update(transactions)
      .set({ amount: "-55.00", bookingDate: addDays(avui, -17) })
      .where(eq(transactions.dedupKey, "b"));

    await declaraComercRecurrent(merchantId, ledgerId, {
      recurrent: true,
      cadence: "monthly",
    });

    // El detector no ha de duplicar ni acabar la serie, i ha de refrescar l'import.
    const stats = await detectaRecurrents(ledgerId);
    expect(stats.creades).toBe(0);
    expect(stats.actualitzades).toBe(1);

    const series = await llistaSeries(ledgerId, false, false);
    expect(series).toHaveLength(1);
    expect(series[0]?.cadence).toBe("monthly");
    expect(series[0]?.isDeclared).toBe(true);
  });
});

describe("POST /comercos/:id/recurrent", () => {
  test("la pagina te la columna Recurrent i el fragment no es una pagina", async () => {
    const pagina = await app.request("/e/personal/comercos", {
      headers: { Cookie: sessio.cookie },
    });
    const html = await pagina.text();
    expect(pagina.status).toBe(200);
    expect(html).toContain("<html");
    expect(html).toContain("<th>Recurrent</th>");
    expect(html).toContain(`/e/personal/comercos/${merchantId}/recurrent`);

    const frag = await app.request("/e/personal/comercos/fragment/taula", {
      headers: { Cookie: sessio.cookie },
    });
    const cos = await frag.text();
    expect(frag.status).toBe(200);
    expect(cos).not.toContain("<html");
    expect(cos).toContain('id="taula-comercos"');
    expect(cos).toContain("<th>Recurrent</th>");
  });

  test("marcar i desmarcar via HTMX", async () => {
    await moviment("via-http", "none", null);
    await db
      .update(transactions)
      .set({ amount: "-120.00", bookingDate: addDays(todayLocal(), -15) })
      .where(eq(transactions.dedupKey, "via-http"));

    const marca = await app.request(`/e/personal/comercos/${merchantId}/recurrent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: sessio.cookie,
        "X-CSRF-Token": sessio.csrf,
        "HX-Request": "true",
      },
      body: "is_recurrent=1&recurrent_cadence=monthly",
    });
    const htmlMarca = await marca.text();
    expect(marca.status).toBe(200);
    expect(htmlMarca).toContain(`id="comerc-${merchantId}"`);
    expect(htmlMarca).toContain("checked");
    expect(htmlMarca).toContain('id="resum-subscripcions"');

    const series = await llistaSeries(ledgerId, false, false);
    expect(series).toHaveLength(1);
    expect(series[0]?.isDeclared).toBe(true);

    const desmarca = await app.request(`/e/personal/comercos/${merchantId}/recurrent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: sessio.cookie,
        "X-CSRF-Token": sessio.csrf,
        "HX-Request": "true",
      },
      body: "recurrent_cadence=monthly",
    });
    expect(desmarca.status).toBe(200);
    const htmlDes = await desmarca.text();
    expect(htmlDes).not.toMatch(/name="is_recurrent"[^>]*checked/);

    const [serie] = await db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.ledgerId, ledgerId));
    expect(serie?.status).toBe("ended");
  });

  test("404 si el comerç no es d'aquest espai", async () => {
    const [foraster] = await db
      .insert(merchants)
      .values({
        ledgerId: altreLedgerId,
        normalizedName: "FORA",
        displayName: "Fora",
        defaultCategoryId: null,
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();

    const res = await app.request(`/e/personal/comercos/${foraster?.id}/recurrent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: sessio.cookie,
        "X-CSRF-Token": sessio.csrf,
        "HX-Request": "true",
      },
      body: "is_recurrent=1&recurrent_cadence=monthly",
    });
    expect(res.status).toBe(404);
  });

  test("422 sense moviments", async () => {
    const res = await app.request(`/e/personal/comercos/${merchantId}/recurrent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: sessio.cookie,
        "X-CSRF-Token": sessio.csrf,
        "HX-Request": "true",
      },
      body: "is_recurrent=1&recurrent_cadence=annual",
    });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('id="toast"');
  });
});
