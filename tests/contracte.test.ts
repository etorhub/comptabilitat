/**
 * The HTMX contract, checked on every page of the application.
 *
 * `htmx-contract/` knows how to find the problems; this brings them to it. The
 * difference matters: a tool that has to be called by hand is a tool somebody
 * will not call, and the four bugs that motivated it happened precisely because
 * the step that would have caught them —opening it in the browser— is skipped.
 *
 * Two things, then:
 *
 *   1. Every page the application knows how to serve goes through `checkDocument()`.
 *   2. **The `PAGINES` table here has to cover all of `src/routes/`**, and there
 *      is a test that checks it. Adding a resource without an entry here fails
 *      CI, the only way this survives whoever does not read `AGENTS.md`.
 *
 * A database is needed: the pages are really requested, with the sample data.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { checkDocument, formatViolations } from "../htmx-contract/index.ts";
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
import { app } from "../src/server.ts";
import { fillForTests } from "../src/services/demo.ts";
import { PASSWORD, requestAs, signIn, type Session } from "./ajuda.ts";

/**
 * The pages, and which resource they belong to.
 *
 * The `recurs` is the name of the directory in `src/routes/`. It is used by the
 * coverage test at the end: without it, the table could fall behind with
 * nothing to say so.
 */
const Pages: { resource: string; url: string; que: string }[] = [
  { resource: "auth", url: "/contrasenya", que: "canvi de contrasenya" },
  { resource: "analytics", url: "/e/personal", que: "panell de l'espai" },
  { resource: "analytics", url: "/e/personal/informes", que: "informes" },
  { resource: "analytics", url: "/e/personal/previsio", que: "previsio de saldo" },
  { resource: "transactions", url: "/e/personal/moviments", que: "llista de moviments" },
  { resource: "transactions", url: "/e/personal/moviments/revisio", que: "safata de revisio" },
  { resource: "recurring", url: "/e/personal/recurrents", que: "recurrents" },
  { resource: "categories", url: "/e/personal/categories", que: "pla de categories" },
  { resource: "tags", url: "/e/personal/etiquetes", que: "etiquetes" },
  { resource: "alerts", url: "/e/personal/avisos", que: "avisos" },
  { resource: "workspaces", url: "/e/personal/configuracio", que: "configuracio de l'espai" },
  { resource: "connections", url: "/connexions", que: "connexions bancaries" },
  { resource: "jobs", url: "/feines", que: "feines del planificador" },
  { resource: "users", url: "/usuaris", que: "usuaris" },
];

/**
 * The resources that have no page, and why.
 *
 * They are the same two that `AGENTS.md` already declares as exceptions to
 * the four-file rule. If one day there is another, better that the coverage
 * test forces the reason to be written here than that it goes by in silence.
 */
const WITHOUT_PAGE: Record<string, string> = {
  exports: "nomes descarregues (CSV, XLSX, PDF), penjades de Moviments i d'Informes",
  home: "nomes redirigeix a l'espai actiu",
};

let session: Session;

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

  // The sample data gives pages with real content: rows, charts and
  // pagination. An empty page checks next to nothing.
  await fillForTests("demo@exemple.cat", PASSWORD);
  session = await signIn("demo@exemple.cat");
}, 180_000);

describe("cada pagina compleix el contracte", () => {
  for (const { url, que } of Pages) {
    test(`${que} (${url})`, async () => {
      const res = await requestAs(session, url);
      expect(res.status).toBe(200);

      const html = await res.text();
      const violacions = await checkDocument(html);

      // The message comes out whole: a list of rules without what they say
      // forces whoever reads it to go and look for the code.
      expect(violacions, `${url}\n${formatViolations(violacions)}`).toEqual([]);
    });
  }
});

describe("l'entrada, que encara no te sessio", () => {
  test("compleix el contracte igualment", async () => {
    // No cookie: it is the only page drawn for someone who has not signed in,
    // and the only one that carries a `_csrf` per form.
    const res = await app.request("/entrada");
    expect(res.status).toBe(200);

    const html = await res.text();
    const violacions = await checkDocument(html);
    expect(violacions, `/entrada\n${formatViolations(violacions)}`).toEqual([]);
  });
});

describe("la cobertura de la taula", () => {
  test("tot recurs de src/routes/ te pagina a la taula o motiu per no tenir-ne", async () => {
    const entrades = await readdir(join(import.meta.dir, "..", "src", "routes"), {
      withFileTypes: true,
    });
    const resources = entrades
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();

    const coberts = new Set(Pages.map((p) => p.resource));
    const oblidats = resources.filter((r) => !coberts.has(r) && !(r in WITHOUT_PAGE));

    expect(
      oblidats,
      `Aquests recursos no son a PAGINES ni a SENSE_PAGINA: ${oblidats.join(", ")}.\n` +
        "Afegeix-hi la seva pagina, o digues per que no en te.",
    ).toEqual([]);
  });

  test("i la taula no anomena cap recurs que ja no existeixi", async () => {
    const entrades = await readdir(join(import.meta.dir, "..", "src", "routes"), {
      withFileTypes: true,
    });
    const resources = new Set(entrades.filter((e) => e.isDirectory()).map((e) => e.name));

    const fantasmes = [...new Set(Pages.map((p) => p.resource)), ...Object.keys(WITHOUT_PAGE)]
      .filter((r) => !resources.has(r))
      .toSorted();

    expect(fantasmes, `Ja no hi ha aquests recursos: ${fantasmes.join(", ")}`).toEqual([]);
  });
});
