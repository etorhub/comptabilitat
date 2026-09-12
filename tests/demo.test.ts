/**
 * Dades d'exemple: han de deixar l'aplicacio en un estat on tot es pugui
 * mirar. Port de `backend/tests/test_demo.py`.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { count, eq, isNull, and } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  alerts,
  balances,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringSeries,
  rules,
  syncRuns,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { fillForTests, type DemoSummary } from "../src/services/demo.ts";
import { app } from "../src/server.ts";

let summary: DemoSummary;

/** La demo triga; es genera un sol cop i totes les proves la miren. */
beforeAll(async () => {
  await db.delete(alerts);
  await db.delete(balances);
  await db.delete(syncRuns);
  await db.delete(recurringSeries);
  await db.delete(transactions);
  await db.delete(rules);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  summary = await fillForTests();
  // Divuit mesos de moviments a tres espais: no cap als 5 s de per defecte.
}, 120_000);

describe("els usuaris", () => {
  test("son tres, amb accessos diferents", async () => {
    const rows = await db
      .select({ email: users.email, code: ledgers.code })
      .from(userLedgerPermissions)
      .innerJoin(users, eq(users.id, userLedgerPermissions.userId))
      .innerJoin(ledgers, eq(ledgers.id, userLedgerPermissions.ledgerId));

    const accessos = new Map<string, string[]>();
    for (const row of rows) {
      accessos.set(row.email, [...(accessos.get(row.email) ?? []), row.code].toSorted());
    }

    expect(accessos.get("demo@exemple.cat")).toEqual(["calella", "pardals", "personal"]);
    expect(accessos.get("parella@exemple.cat")).toEqual(["pardals"]);
    expect(accessos.get("sogra@exemple.cat")).toEqual(["calella"]);
  });

  test("l'usuari de la demo pot entrar i veu els tres espais", async () => {
    const getLogin = await app.request("/entrada");
    const loginHtml = await getLogin.text();
    const seedCookie = (getLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const field = /name="_csrf" value="([^"]+)"/.exec(loginHtml)?.[1] ?? "";

    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: new URLSearchParams({
        _csrf: field,
        email: summary.user ?? "",
        password: summary.contrasenya ?? "",
      }).toString(),
    });

    expect(res.status).toBe(303);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    // El selector de la barra lateral ha de dur-hi els tres espais.
    const page = await app.request("/e/personal", { headers: { Cookie: cookie } });
    const body = await page.text();
    expect(page.status).toBe(200);
    for (const code of ["personal", "calella", "pardals"]) {
      expect(body).toContain(`<option value="${code}"`);
    }
  });
});

describe("les dades", () => {
  test("hi ha moviments, comptes i recurrents als tres espais", async () => {
    expect(summary.state).toBe("fet");
    expect(summary.transactionList ?? 0).toBeGreaterThan(200);
    expect(summary.accountList).toBe(3);

    const [nComptes] = await db.select({ n: count() }).from(accounts);
    expect(nComptes?.n).toBe(3);

    const espaisAmbMoviments = new Set(
      (await db.select({ ledgerId: transactions.ledgerId }).from(transactions)).map(
        (t) => t.ledgerId,
      ),
    );
    expect(espaisAmbMoviments.size).toBe(3);

    // Els rebuts recurrents son el que alimenta la previsio.
    const [nSeries] = await db.select({ n: count() }).from(recurringSeries);
    expect(nSeries?.n ?? 0).toBeGreaterThanOrEqual(5);
  });

  test("els moviments queden classificats", async () => {
    const [without] = await db
      .select({ n: count() })
      .from(transactions)
      .where(and(isNull(transactions.categoryId), isNull(transactions.transferGroupId)));

    expect(without?.n).toBe(0);
  });
});

describe("tornar-la a executar", () => {
  test("no trepitja les dades que ja hi ha", async () => {
    const [abans] = await db.select({ n: count() }).from(transactions);

    const segona = await fillForTests();

    expect(segona.state).toContain("ja hi havia dades");
    const [despres] = await db.select({ n: count() }).from(transactions);
    expect(despres?.n).toBe(abans?.n ?? -1);
    const [nUsuaris] = await db.select({ n: count() }).from(users);
    expect(nUsuaris?.n).toBe(3);
  });
});
