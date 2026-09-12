/**
 * El contracte d'HTMX, comprovat a totes les pagines de l'aplicacio.
 *
 * `htmx-contract/` sap trobar els problemes; aixo els hi porta. La diferencia
 * importa: una eina que s'ha de cridar a ma es una eina que algu no cridara, i
 * els quatre errors que la van motivar van passar precisament perque el pas que
 * els hauria vist —obrir-ho al navegador— es el que es salta.
 *
 * Dues coses, doncs:
 *
 *   1. Cada pagina que l'aplicacio sap servir passa per `checkDocument()`.
 *   2. **La `taula` d'aqui ha de cobrir tot `src/routes/`**, i hi ha una prova
 *      que ho comprova. Afegir un recurs sense entrada aqui fa fallar el CI, que
 *      es l'unica manera que aixo sobrevisqui a qui no llegeixi l'`AGENTS.md`.
 *
 * Cal base de dades: les pagines es demanen de debo, amb les dades d'exemple.
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
 * Les pagines, i de quin recurs son.
 *
 * El `recurs` es el nom del directori de `src/routes/`. Serveix per a la prova
 * de cobertura del final: sense ell, la taula podria quedar-se enrere sense que
 * res ho digues.
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
 * Els recursos que no tenen cap pagina, i per que.
 *
 * Son els mateixos dos que l'`AGENTS.md` ja declara com a excepcions de la
 * regla dels quatre fitxers. Si un dia n'hi ha un altre, val mes que la prova
 * de cobertura obligui a escriure aqui el motiu que no pas que passi en silenci.
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

  // Les dades d'exemple donen pagines amb contingut de debo: files, grafics i
  // paginacio. Una pagina buida no comprova gaire res.
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

      // El missatge surt sencer: una llista de regles sense el que diuen
      // obliga qui ho llegeixi a anar a buscar el codi.
      expect(violacions, `${url}\n${formatViolations(violacions)}`).toEqual([]);
    });
  }
});

describe("l'entrada, que encara no te sessio", () => {
  test("compleix el contracte igualment", async () => {
    // Sense galeta: es l'unica pagina que es dibuixa per a qui no ha entrat, i
    // l'unica que duu un `_csrf` per formulari.
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
