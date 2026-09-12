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
 *   2. **The `Pages` table here has to cover all of `src/routes/`**, and there
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
 * The `resource` is the name of the directory in `src/routes/`. It is used by the
 * coverage test at the end: without it, the table could fall behind with
 * nothing to say so.
 */
const Pages: { resource: string; url: string; what: string }[] = [
  { resource: "auth", url: "/contrasenya", what: "canvi de contrasenya" },
  { resource: "analytics", url: "/e/personal", what: "panell de l'espai" },
  { resource: "analytics", url: "/e/personal/informes", what: "informes" },
  { resource: "analytics", url: "/e/personal/previsio", what: "previsio de saldo" },
  { resource: "transactions", url: "/e/personal/moviments", what: "llista de moviments" },
  { resource: "transactions", url: "/e/personal/moviments/revisio", what: "safata de revisio" },
  { resource: "recurring", url: "/e/personal/recurrents", what: "recurrents" },
  { resource: "categories", url: "/e/personal/categories", what: "pla de categories" },
  { resource: "tags", url: "/e/personal/etiquetes", what: "etiquetes" },
  { resource: "alerts", url: "/e/personal/avisos", what: "avisos" },
  { resource: "workspaces", url: "/e/personal/configuracio", what: "configuracio de l'espai" },
  { resource: "connections", url: "/connexions", what: "connexions bancaries" },
  { resource: "jobs", url: "/feines", what: "feines del planificador" },
  { resource: "users", url: "/usuaris", what: "usuaris" },
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

describe("every page meets the contract", () => {
  for (const { url, what } of Pages) {
    test(`${what} (${url})`, async () => {
      const res = await requestAs(session, url);
      expect(res.status).toBe(200);

      const html = await res.text();
      const violations = await checkDocument(html);

      // The message comes out whole: a list of rules without what they say
      // forces whoever reads it to go and look for the code.
      expect(violations, `${url}\n${formatViolations(violations)}`).toEqual([]);
    });
  }
});

describe("the sign-in page, which has no session yet", () => {
  test("meets the contract all the same", async () => {
    // No cookie: it is the only page drawn for someone who has not signed in,
    // and the only one that carries a `_csrf` per form.
    const res = await app.request("/entrada");
    expect(res.status).toBe(200);

    const html = await res.text();
    const violations = await checkDocument(html);
    expect(violations, `/entrada\n${formatViolations(violations)}`).toEqual([]);
  });
});

describe("the table's coverage", () => {
  test("every resource in src/routes/ has a page in the table or a reason not to", async () => {
    const entries = await readdir(join(import.meta.dir, "..", "src", "routes"), {
      withFileTypes: true,
    });
    const resources = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();

    const covered = new Set(Pages.map((p) => p.resource));
    const forgotten = resources.filter((r) => !covered.has(r) && !(r in WITHOUT_PAGE));

    expect(
      forgotten,
      `These resources are in neither Pages nor WITHOUT_PAGE: ${forgotten.join(", ")}.\n` +
        "Add their page, or say why they have none.",
    ).toEqual([]);
  });

  test("and the table names no resource that no longer exists", async () => {
    const entries = await readdir(join(import.meta.dir, "..", "src", "routes"), {
      withFileTypes: true,
    });
    const resources = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));

    const ghosts = [...new Set(Pages.map((p) => p.resource)), ...Object.keys(WITHOUT_PAGE)]
      .filter((r) => !resources.has(r))
      .toSorted();

    expect(ghosts, `These resources are gone: ${ghosts.join(", ")}`).toEqual([]);
  });
});
