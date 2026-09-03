/**
 * Regles, memoria de comerços i cua de revisio, dins d'un espai.
 *
 * Port de `backend/tests/test_classification.py`. La invariant que es
 * comprova tot el temps: **el que ha decidit una persona no ho toca res**.
 *
 * Cal una base de dades:
 *   DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
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
  rules,
  transactions,
  userLedgerPermissions,
  users,
  type Rule,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { classificaMoviment, classificaPendents } from "../src/services/classification.ts";
import { reglesActives } from "../src/services/rules.ts";
import { seedCategories } from "../src/services/seed.ts";
import { app } from "../src/server.ts";

const CONTRASENYA = "provaprovaprova";
const AVUI = "2026-02-10";

let personalId = 0;
let calellaId = 0;
let comptePersonal = 0;
let compteCalella = 0;
let sessio = { cookie: "", csrf: "" };

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

function envia(url: string, cos: Record<string, string | string[]>): Promise<Response> {
  const params = new URLSearchParams();
  for (const [clau, valor] of Object.entries(cos)) {
    if (Array.isArray(valor)) for (const v of valor) params.append(clau, v);
    else params.set(clau, valor);
  }
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessio.cookie,
      "X-CSRF-Token": sessio.csrf,
      "HX-Request": "true",
    },
    body: params.toString(),
  });
}

async function categoria(ledgerId: number, slug = "alimentacio-supermercat") {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta la categoria ${slug}`);
  return c;
}

interface OpcionsMoviment {
  amount?: string;
  dia?: string;
  normalized?: string;
  merchantId?: number | null;
  categoryId?: number | null;
  categorySource?: "none" | "user" | "rule" | "merchant" | "llm";
  needsReview?: boolean;
  accountId?: number;
  ledgerId?: number;
}

async function moviment(opcions: OpcionsMoviment = {}): Promise<number> {
  const amount = opcions.amount ?? "-30.00";
  const dia = opcions.dia ?? AVUI;
  const normalized = opcions.normalized ?? "MERCADONA";
  const accountId = opcions.accountId ?? comptePersonal;

  const [fila] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId: opcions.ledgerId ?? personalId,
      dedupKey: `k-${accountId}-${amount}-${dia}-${normalized.slice(0, 8)}`,
      source: "bank",
      bookingDate: dia,
      amount,
      currency: "EUR",
      status: "booked",
      description: `COMPRA EN ${normalized}`,
      normalizedDescription: normalized,
      counterparty: "",
      bankTransactionCode: "",
      merchantId: opcions.merchantId ?? null,
      categoryId: opcions.categoryId ?? null,
      categorySource: opcions.categorySource ?? "none",
      needsReview: opcions.needsReview ?? false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    })
    .returning();
  return fila?.id ?? 0;
}

async function comerc(nom = "MERCADONA", extra: Partial<typeof merchants.$inferInsert> = {}) {
  const [m] = await db
    .insert(merchants)
    .values({
      ledgerId: personalId,
      normalizedName: nom,
      displayName: nom.charAt(0) + nom.slice(1).toLowerCase(),
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 0,
      ...extra,
    })
    .returning();
  return m?.id ?? 0;
}

async function creaRegla(valors: Partial<typeof rules.$inferInsert> & { name: string }) {
  await db.insert(rules).values({
    ledgerId: personalId,
    priority: 100,
    isActive: true,
    source: "manual",
    conditions: [],
    setCategoryId: null,
    setMerchantId: null,
    setTags: [],
    stopProcessing: true,
    matchCount: 0,
    ...valors,
  });
}

/** Torna a llegir un moviment de la base de dades. */
async function llegeix(id: number) {
  const [fila] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!fila) throw new Error("el moviment ha desaparegut");
  return fila;
}

async function classifica(id: number): Promise<void> {
  const fila = await llegeix(id);
  const regles: Rule[] = await reglesActives(personalId);
  await classificaMoviment(
    {
      id: fila.id,
      ledgerId: fila.ledgerId,
      description: fila.description,
      normalizedDescription: fila.normalizedDescription,
      counterparty: fila.counterparty,
      amount: fila.amount,
      bankTransactionCode: fila.bankTransactionCode,
      accountId: fila.accountId,
      merchantId: fila.merchantId,
      categorySource: fila.categorySource,
      tags: fila.tags,
    },
    regles,
  );
}

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(rules);
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
        name: code === "personal" ? "Personal" : "Calella",
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
  personalId = espais.find((e) => e.code === "personal")?.id ?? 0;
  calellaId = espais.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(personalId);
  await seedCategories(calellaId);

  const [connexio] = await db
    .insert(bankConnections)
    .values({
      name: "S",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();

  const comptes = await db
    .insert(accounts)
    .values(
      [
        { uid: "uid-1", ledgerId: personalId },
        { uid: "uid-2", ledgerId: calellaId },
      ].map((c) => ({
        connectionId: connexio?.id ?? 0,
        ledgerId: c.ledgerId,
        ebAccountUid: c.uid,
        name: "C",
        product: "",
        iban: "ES00",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      })),
    )
    .returning();
  comptePersonal = comptes.find((c) => c.ebAccountUid === "uid-1")?.id ?? 0;
  compteCalella = comptes.find((c) => c.ebAccountUid === "uid-2")?.id ?? 0;

  const [anna] = await db
    .insert(users)
    .values({
      email: "anna@exemple.cat",
      fullName: "Anna",
      passwordHash: await hashPassword(CONTRASENYA),
      isAdmin: false,
      isActive: true,
    })
    .returning();

  await db.insert(userLedgerPermissions).values([
    { userId: anna?.id ?? 0, ledgerId: personalId, role: "admin" },
    { userId: anna?.id ?? 0, ledgerId: calellaId, role: "admin" },
  ]);

  sessio = await entra("anna@exemple.cat");
});

describe("les regles", () => {
  test("una regla assigna la categoria", async () => {
    const supermercat = await categoria(personalId);
    await creaRegla({
      name: "Mercadona",
      priority: 10,
      conditions: [
        { field: "normalized_description", operator: "contains", value: "MERCADONA" },
      ],
      setCategoryId: supermercat.id,
    });
    const id = await moviment();

    await classifica(id);

    const fila = await llegeix(id);
    expect(fila.categoryId).toBe(supermercat.id);
    expect(fila.categorySource).toBe("rule");
    expect(fila.needsReview).toBe(false);
  });

  test("respecten la prioritat: la mes baixa guanya", async () => {
    const supermercat = await categoria(personalId);
    const restaurants = await categoria(personalId, "restauracio-restaurants");
    await creaRegla({
      name: "general",
      priority: 100,
      conditions: [{ field: "description", operator: "contains", value: "COMPRA" }],
      setCategoryId: restaurants.id,
    });
    await creaRegla({
      name: "especifica",
      priority: 10,
      conditions: [{ field: "description", operator: "contains", value: "MERCADONA" }],
      setCategoryId: supermercat.id,
    });
    const id = await moviment();

    await classifica(id);

    expect((await llegeix(id)).categoryId).toBe(supermercat.id);
  });
});

describe("la memoria de comerços", () => {
  test("classifica sense cap regla", async () => {
    const supermercat = await categoria(personalId);
    const comercId = await comerc("MERCADONA", {
      defaultCategoryId: supermercat.id,
      isConfirmed: true,
    });
    const id = await moviment({ merchantId: comercId });

    await classifica(id);

    const fila = await llegeix(id);
    expect(fila.categoryId).toBe(supermercat.id);
    expect(fila.categorySource).toBe("merchant");
    expect(fila.needsReview).toBe(false);
  });

  test("un comerç no confirmat es marca per revisar", async () => {
    const supermercat = await categoria(personalId);
    const comercId = await comerc("MERCADONA", {
      defaultCategoryId: supermercat.id,
      isConfirmed: false,
    });
    const id = await moviment({ merchantId: comercId });

    await classifica(id);

    expect((await llegeix(id)).needsReview).toBe(true);
  });
});

describe("el que decideix una persona", () => {
  test("no es sobreescriu mai, ni per una regla", async () => {
    const supermercat = await categoria(personalId);
    const restaurants = await categoria(personalId, "restauracio-restaurants");
    await creaRegla({
      name: "Mercadona",
      conditions: [
        { field: "normalized_description", operator: "contains", value: "MERCADONA" },
      ],
      setCategoryId: supermercat.id,
    });
    const id = await moviment({ categoryId: restaurants.id, categorySource: "user" });

    await classifica(id);

    expect((await llegeix(id)).categoryId).toBe(restaurants.id);
  });
});

describe("la cua de revisio", () => {
  test("els moviments sense res queden per revisar", async () => {
    const id = await moviment({ normalized: "ALGUNA COSA RARA" });

    const estadistiques = await classificaPendents(personalId);

    expect(estadistiques.pendents).toBe(1);
    expect((await llegeix(id)).needsReview).toBe(true);
  });

  test("la pagina de revisio nomes llista els pendents", async () => {
    await moviment({ needsReview: true });
    await moviment({ amount: "-10.00", dia: "2026-02-08" });

    const res = await app.request("/e/personal/moviments/revisio", {
      headers: { Cookie: sessio.cookie },
    });
    const cos = await res.text();

    expect(res.status).toBe(200);
    expect(cos).toContain("-30,00");
    expect(cos).not.toContain("-10,00");
  });
});

describe("corregir una categoria", () => {
  test("recorda el comerç i ho propaga als seus moviments", async () => {
    const comercId = await comerc();
    const primer = await moviment({ merchantId: comercId });
    const segon = await moviment({ amount: "-12.00", dia: "2026-02-09", merchantId: comercId });
    const supermercat = await categoria(personalId);

    const res = await envia(`/e/personal/moviments/${primer}/categoria`, {
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(200);
    const [comercFila] = await db.select().from(merchants).where(eq(merchants.id, comercId));
    expect(comercFila?.defaultCategoryId).toBe(supermercat.id);
    expect(comercFila?.isConfirmed).toBe(true);
    expect((await llegeix(segon)).categoryId).toBe(supermercat.id);
  });

  test("pot crear-ne una regla apresa", async () => {
    const id = await moviment();
    const supermercat = await categoria(personalId);

    const res = await envia(`/e/personal/moviments/${id}/categoria`, {
      category_id: String(supermercat.id),
      crea_regla: "on",
    });

    expect(res.status).toBe(200);
    const [regla] = await db.select().from(rules).where(eq(rules.source, "learned"));
    expect(regla).toBeDefined();
    expect(regla?.ledgerId).toBe(personalId);
  });
});

describe("la recategoritzacio en lot", () => {
  test("aplica la categoria a tots els triats", async () => {
    const primer = await moviment();
    const segon = await moviment({ amount: "-40.00", dia: "2026-02-09" });
    const supermercat = await categoria(personalId);

    const res = await envia("/e/personal/moviments/bloc", {
      moviment: [String(primer), String(segon)],
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(200);
    expect((await llegeix(primer)).categoryId).toBe(supermercat.id);
    expect((await llegeix(segon)).categoryId).toBe(supermercat.id);
  });

  test("si algun moviment no es de l'espai, no se n'aplica cap", async () => {
    const meu = await moviment();
    const alie = await moviment({ accountId: compteCalella, ledgerId: calellaId });
    const supermercat = await categoria(personalId);

    const res = await envia("/e/personal/moviments/bloc", {
      moviment: [String(meu), String(alie)],
      category_id: String(supermercat.id),
    });

    expect(res.status).toBe(404);
    expect((await llegeix(meu)).categorySource).toBe("none");
    expect((await llegeix(alie)).categorySource).toBe("none");
  });
});
