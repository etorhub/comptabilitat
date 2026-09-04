/**
 * Etiquetes: alta/baixa, sumes, pagina vs fragment, permisos.
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
  rules,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { money } from "../src/lib/money.ts";
import { seedCategories } from "../src/services/seed.ts";
import {
  afegeixEtiqueta,
  esborraEtiquetaDeLespai,
  llistaEtiquetes,
  mateixaEtiqueta,
  normalitzaEtiqueta,
  treuEtiqueta,
} from "../src/services/tags.ts";
import { app } from "../src/server.ts";

const CONTRASENYA = "provaprovaprova";

let personalId = 0;
let calellaId = 0;
let comptePersonal = 0;
let compteCalella = 0;
let movimentPersonal = 0;
let movimentCalella = 0;
let sessioEditor = { cookie: "", csrf: "" };
let sessioViewer = { cookie: "", csrf: "" };
let sessioAdmin = { cookie: "", csrf: "" };

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

async function envia(
  url: string,
  cos: Record<string, string>,
  sessio = sessioEditor,
): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessio.cookie,
      "X-CSRF-Token": sessio.csrf,
      "HX-Request": "true",
    },
    body: new URLSearchParams(cos).toString(),
  });
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
  personalId = espais.find((e) => e.code === "personal")?.id ?? 0;
  calellaId = espais.find((e) => e.code === "calella")?.id ?? 0;
  await seedCategories(personalId);
  await seedCategories(calellaId);

  const passwordHash = await hashPassword(CONTRASENYA);
  const creats = await db
    .insert(users)
    .values([
      {
        email: "editor@exemple.cat",
        fullName: "Editor",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
      {
        email: "viewer@exemple.cat",
        fullName: "Viewer",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
      {
        email: "admin@exemple.cat",
        fullName: "Admin",
        passwordHash,
        isAdmin: true,
        isActive: true,
      },
    ])
    .returning();
  const editor = creats.find((u) => u.email === "editor@exemple.cat");
  const viewer = creats.find((u) => u.email === "viewer@exemple.cat");
  const admin = creats.find((u) => u.email === "admin@exemple.cat");
  if (!editor || !viewer || !admin) throw new Error("usuaris");

  await db.insert(userLedgerPermissions).values([
    { userId: editor.id, ledgerId: personalId, role: "editor" },
    { userId: viewer.id, ledgerId: personalId, role: "viewer" },
    { userId: admin.id, ledgerId: personalId, role: "editor" },
  ]);

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

  const comptes = await db
    .insert(accounts)
    .values([
      {
        connectionId: connexio?.id ?? 0,
        ledgerId: personalId,
        ebAccountUid: "uid-p",
        name: "Personal",
        product: "",
        iban: "ES00",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      },
      {
        connectionId: connexio?.id ?? 0,
        ledgerId: calellaId,
        ebAccountUid: "uid-c",
        name: "Calella",
        product: "",
        iban: "ES01",
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        raw: {},
      },
    ])
    .returning();
  comptePersonal = comptes.find((a) => a.ledgerId === personalId)?.id ?? 0;
  compteCalella = comptes.find((a) => a.ledgerId === calellaId)?.id ?? 0;

  const movs = await db
    .insert(transactions)
    .values([
      {
        accountId: comptePersonal,
        ledgerId: personalId,
        dedupKey: "k-p-1",
        source: "manual",
        bookingDate: "2026-02-10",
        amount: "-100.00",
        currency: "EUR",
        status: "booked",
        description: "Floristeria",
        normalizedDescription: "FLORISTERIA",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: comptePersonal,
        ledgerId: personalId,
        dedupKey: "k-p-2",
        source: "manual",
        bookingDate: "2026-02-11",
        amount: "-50.00",
        currency: "EUR",
        status: "booked",
        description: "Restaurant",
        normalizedDescription: "RESTAURANT",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: comptePersonal,
        ledgerId: personalId,
        dedupKey: "k-p-3",
        source: "manual",
        bookingDate: "2026-02-12",
        amount: "20.00",
        currency: "EUR",
        status: "booked",
        description: "Regal rebut",
        normalizedDescription: "REGAL",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
      {
        accountId: compteCalella,
        ledgerId: calellaId,
        dedupKey: "k-c-1",
        source: "manual",
        bookingDate: "2026-02-10",
        amount: "-9.00",
        currency: "EUR",
        status: "booked",
        description: "De Calella",
        normalizedDescription: "CALELLA",
        counterparty: "",
        bankTransactionCode: "",
        categoryId: null,
        categorySource: "none",
        needsReview: false,
        notes: "",
        tags: [],
        isExcluded: false,
        raw: {},
      },
    ])
    .returning();

  movimentPersonal = movs.find((m) => m.dedupKey === "k-p-1")?.id ?? 0;
  movimentCalella = movs.find((m) => m.dedupKey === "k-c-1")?.id ?? 0;

  sessioEditor = await entra("editor@exemple.cat");
  sessioViewer = await entra("viewer@exemple.cat");
  sessioAdmin = await entra("admin@exemple.cat");
});

describe("normalitzaEtiqueta", () => {
  test("retalla i col·lapsa espais", () => {
    expect(normalitzaEtiqueta("  casament  ")).toBe("casament");
    expect(normalitzaEtiqueta("projecte   X")).toBe("projecte X");
  });

  test("rebutja comes i buits", () => {
    expect(() => normalitzaEtiqueta("a,b")).toThrow();
    expect(() => normalitzaEtiqueta("   ")).toThrow();
  });

  test("compara sense majuscules", () => {
    expect(mateixaEtiqueta("Casament", "casament")).toBe(true);
  });
});

describe("servei d'etiquetes", () => {
  test("afegeix i treu d'un moviment", async () => {
    await afegeixEtiqueta(movimentPersonal, personalId, "casament");
    const [fila] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, movimentPersonal));
    expect(fila?.tags).toEqual(["casament"]);

    await treuEtiqueta(movimentPersonal, personalId, "Casament");
    const [despres] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, movimentPersonal));
    expect(despres?.tags).toEqual([]);
  });

  test("no duplica si canvia la majuscula", async () => {
    await afegeixEtiqueta(movimentPersonal, personalId, "casament");
    await afegeixEtiqueta(movimentPersonal, personalId, "Casament");
    const [fila] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, movimentPersonal));
    expect(fila?.tags).toEqual(["casament"]);
  });

  test("suma ingressos i despeses amb Decimal", async () => {
    const segon = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-2"))
    )[0]?.id;
    const tercer = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-3"))
    )[0]?.id;
    if (!segon || !tercer) throw new Error("falten moviments");

    await afegeixEtiqueta(movimentPersonal, personalId, "casament");
    await afegeixEtiqueta(segon, personalId, "casament");
    await afegeixEtiqueta(tercer, personalId, "casament");

    const llista = await llistaEtiquetes(personalId);
    const casament = llista.find((e) => e.nom === "casament");
    expect(casament).toBeDefined();
    expect(casament?.moviments).toBe(3);
    expect(casament?.despeses).toBe("150.00");
    expect(casament?.ingressos).toBe("20.00");
    expect(casament?.net).toBe("-130.00");
    // Cap parseFloat: el net es la resta exacta amb Decimal.
    expect(
      money(casament?.ingressos ?? "0")
        .minus(money(casament?.despeses ?? "0"))
        .toFixed(2),
    ).toBe("-130.00");
  });

  test("esborra de tot l'espai", async () => {
    const segon = (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.dedupKey, "k-p-2"))
    )[0]?.id;
    if (!segon) throw new Error("falta");
    await afegeixEtiqueta(movimentPersonal, personalId, "casament");
    await afegeixEtiqueta(segon, personalId, "casament");
    const quants = await esborraEtiquetaDeLespai(personalId, "Casament");
    expect(quants).toBe(2);
    expect(await llistaEtiquetes(personalId)).toEqual([]);
  });
});

describe("rutes d'etiquetes", () => {
  test("afegeix des de la fila", async () => {
    const res = await envia(`/e/personal/moviments/${movimentPersonal}/etiquetes`, {
      nova_etiqueta: "casament",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("casament");
    expect(html).toContain(`id="moviment-${movimentPersonal}"`);
  });

  test("la pagina i el fragment no son la mateixa adreça", async () => {
    await afegeixEtiqueta(movimentPersonal, personalId, "casament");

    const pagina = await app.request("/e/personal/etiquetes/casament", {
      headers: { Cookie: sessioAdmin.cookie },
    });
    const fragment = await app.request("/e/personal/etiquetes/casament/fragment/taula", {
      headers: { Cookie: sessioAdmin.cookie },
    });

    expect(pagina.status).toBe(200);
    expect(fragment.status).toBe(200);
    const htmlPagina = await pagina.text();
    const htmlFragment = await fragment.text();
    expect(htmlPagina).toContain("<!doctype html>");
    expect(htmlFragment).not.toContain("<!doctype html>");
    expect(htmlFragment).toContain('id="taula-etiqueta"');
  });

  test("l'index mostra la suma", async () => {
    await afegeixEtiqueta(movimentPersonal, personalId, "casament");
    const res = await app.request("/e/personal/etiquetes", {
      headers: { Cookie: sessioAdmin.cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("casament");
    expect(html).toContain("100,00");
  });

  test("qui no es administrador no veu les pagines d'etiquetes", async () => {
    const res = await app.request("/e/personal/etiquetes", {
      headers: { Cookie: sessioEditor.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("un viewer no pot mutar", async () => {
    const res = await envia(
      `/e/personal/moviments/${movimentPersonal}/etiquetes`,
      { nova_etiqueta: "casament" },
      sessioViewer,
    );
    expect(res.status).toBe(403);
  });

  test("no es pot etiquetar un moviment d'un altre espai", async () => {
    const res = await envia(`/e/personal/moviments/${movimentCalella}/etiquetes`, {
      nova_etiqueta: "casament",
    });
    expect(res.status).toBe(404);
  });
});
