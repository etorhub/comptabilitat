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
import { omplePerAProves } from "../src/services/demo.ts";
import { CONTRASENYA, comA, entra, type Sessio } from "./ajuda.ts";

/**
 * Les pagines, i de quin recurs son.
 *
 * El `recurs` es el nom del directori de `src/routes/`. Serveix per a la prova
 * de cobertura del final: sense ell, la taula podria quedar-se enrere sense que
 * res ho digues.
 */
const PAGINES: { recurs: string; url: string; que: string }[] = [
  { recurs: "auth", url: "/contrasenya", que: "canvi de contrasenya" },
  { recurs: "analytics", url: "/e/personal", que: "panell de l'espai" },
  { recurs: "analytics", url: "/e/personal/informes", que: "informes" },
  { recurs: "analytics", url: "/e/personal/previsio", que: "previsio de saldo" },
  { recurs: "transactions", url: "/e/personal/moviments", que: "llista de moviments" },
  { recurs: "transactions", url: "/e/personal/moviments/revisio", que: "safata de revisio" },
  { recurs: "recurring", url: "/e/personal/recurrents", que: "recurrents" },
  { recurs: "categories", url: "/e/personal/categories", que: "pla de categories" },
  { recurs: "tags", url: "/e/personal/etiquetes", que: "etiquetes" },
  { recurs: "alerts", url: "/e/personal/avisos", que: "avisos" },
  { recurs: "workspaces", url: "/e/personal/configuracio", que: "configuracio de l'espai" },
  { recurs: "connections", url: "/connexions", que: "connexions bancaries" },
  { recurs: "jobs", url: "/feines", que: "feines del planificador" },
  { recurs: "users", url: "/usuaris", que: "usuaris" },
];

/**
 * Els recursos que no tenen cap pagina, i per que.
 *
 * Son els mateixos dos que l'`AGENTS.md` ja declara com a excepcions de la
 * regla dels quatre fitxers. Si un dia n'hi ha un altre, val mes que la prova
 * de cobertura obligui a escriure aqui el motiu que no pas que passi en silenci.
 */
const SENSE_PAGINA: Record<string, string> = {
  exports: "nomes descarregues (CSV, XLSX, PDF), penjades de Moviments i d'Informes",
  home: "nomes redirigeix a l'espai actiu",
};

let sessio: Sessio;

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
  await omplePerAProves("demo@exemple.cat", CONTRASENYA);
  sessio = await entra("demo@exemple.cat");
}, 180_000);

describe("cada pagina compleix el contracte", () => {
  for (const { url, que } of PAGINES) {
    test(`${que} (${url})`, async () => {
      const res = await comA(sessio, url);
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
    const recursos = entrades
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();

    const coberts = new Set(PAGINES.map((p) => p.recurs));
    const oblidats = recursos.filter((r) => !coberts.has(r) && !(r in SENSE_PAGINA));

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
    const recursos = new Set(entrades.filter((e) => e.isDirectory()).map((e) => e.name));

    const fantasmes = [...new Set(PAGINES.map((p) => p.recurs)), ...Object.keys(SENSE_PAGINA)]
      .filter((r) => !recursos.has(r))
      .toSorted();

    expect(fantasmes, `Ja no hi ha aquests recursos: ${fantasmes.join(", ")}`).toEqual([]);
  });
});
