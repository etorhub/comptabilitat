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
import { omplePerAProves, type ResumDemo } from "../src/services/demo.ts";
import { app } from "../src/server.ts";

let resum: ResumDemo;

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

  resum = await omplePerAProves();
  // Divuit mesos de moviments a tres espais: no cap als 5 s de per defecte.
}, 120_000);

describe("els usuaris", () => {
  test("son tres, amb accessos diferents", async () => {
    const files = await db
      .select({ email: users.email, codi: ledgers.code })
      .from(userLedgerPermissions)
      .innerJoin(users, eq(users.id, userLedgerPermissions.userId))
      .innerJoin(ledgers, eq(ledgers.id, userLedgerPermissions.ledgerId));

    const accessos = new Map<string, string[]>();
    for (const fila of files) {
      accessos.set(fila.email, [...(accessos.get(fila.email) ?? []), fila.codi].sort());
    }

    expect(accessos.get("demo@exemple.cat")).toEqual(["calella", "pardals", "personal"]);
    expect(accessos.get("parella@exemple.cat")).toEqual(["pardals"]);
    expect(accessos.get("sogra@exemple.cat")).toEqual(["calella"]);
  });

  test("l'usuari de la demo pot entrar i veu els tres espais", async () => {
    const getEntrada = await app.request("/entrada");
    const htmlEntrada = await getEntrada.text();
    const seedCookie = (getEntrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";

    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: new URLSearchParams({
        _csrf: camp,
        email: resum.usuari ?? "",
        password: resum.contrasenya ?? "",
      }).toString(),
    });

    expect(res.status).toBe(303);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    // El selector de la barra lateral ha de dur-hi els tres espais.
    const pagina = await app.request("/e/personal", { headers: { Cookie: cookie } });
    const cos = await pagina.text();
    expect(pagina.status).toBe(200);
    for (const codi of ["personal", "calella", "pardals"]) {
      expect(cos).toContain(`<option value="${codi}"`);
    }
  });
});

describe("les dades", () => {
  test("hi ha moviments, comptes i recurrents als tres espais", async () => {
    expect(resum.estat).toBe("fet");
    expect(resum.moviments ?? 0).toBeGreaterThan(200);
    expect(resum.comptes).toBe(3);

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
    const [sense] = await db
      .select({ n: count() })
      .from(transactions)
      .where(and(isNull(transactions.categoryId), isNull(transactions.transferGroupId)));

    expect(sense?.n).toBe(0);
  });
});

describe("tornar-la a executar", () => {
  test("no trepitja les dades que ja hi ha", async () => {
    const [abans] = await db.select({ n: count() }).from(transactions);

    const segona = await omplePerAProves();

    expect(segona.estat).toContain("ja hi havia dades");
    const [despres] = await db.select({ n: count() }).from(transactions);
    expect(despres?.n).toBe(abans?.n ?? -1);
    const [nUsuaris] = await db.select({ n: count() }).from(users);
    expect(nUsuaris?.n).toBe(3);
  });
});
