/**
 * Els dos sondejos de l'aplicacio, i que s'aturen.
 *
 * L'error (`f80df91`) va ser aquest: una importacio interrompuda deixava la
 * fila en `running` per sempre, i com que el fragment nomes deixava de sondejar
 * quan l'estat era terminal, la pagina ho preguntava cada dos segons
 * indefinidament, per a tothom qui la mires.
 *
 * El que es comprova aqui no es «sondeja», sino **que es rendeix**.
 */

import { describe, expect, test } from "bun:test";

import { checkDocument, type RuleName, type Violation } from "../../htmx-contract/index.ts";
import { SyncState } from "../../src/routes/connections/connections.fragment.ts";
import { Running } from "../../src/routes/jobs/jobs.fragment.ts";
import { MAX_ATTEMPTS } from "../../src/lib/sondeig.ts";
import type { JobRun, SyncRun } from "../../src/db/schema/index.ts";

function regles(violacions: Violation[]): RuleName[] {
  return violacions.map((v) => v.rule);
}

// Sense `as`: el tipus ve de la taula de Drizzle, i si algun dia hi apareix
// una columna nova val mes que aixo peti aqui que no pas que dibuixem una
// fila que no s'assembla a les de debo.
function syncRun(status: SyncRun["status"]): SyncRun {
  return {
    id: 1,
    connectionId: 4,
    status,
    trigger: "manual",
    startedAt: new Date("2026-03-01T10:00:00Z"),
    finishedAt: status === "running" ? null : new Date("2026-03-01T10:01:00Z"),
    accountsSynced: 0,
    transactionsInserted: 0,
    transactionsUpdated: 0,
    error: "",
  };
}

function job(): JobRun {
  return {
    id: 1,
    jobName: "sync",
    status: "running",
    trigger: "manual",
    startedAt: new Date("2026-03-01T10:00:00Z"),
    finishedAt: null,
    parentId: null,
    summary: "",
    error: "",
  };
}

describe("l'estat d'una importacio", () => {
  test("mentre corre, sondeja —i el sondeig es acotat", async () => {
    const html = String(await SyncState({ connectionId: 4, run: syncRun("running") }));
    expect(html).toContain("hx-trigger=");
    expect(regles(await checkDocument(html, { fragment: true }))).not.toContain(
      "unbounded-poll",
    );
  });

  test("el compte d'intents viatja a l'adreça, no al client", async () => {
    const html = String(
      await SyncState({ connectionId: 4, run: syncRun("running"), attempt: 7 }),
    );
    expect(html).toContain("intent=8");
  });

  test("quan acaba, deixa de sondejar", async () => {
    const html = String(await SyncState({ connectionId: 4, run: syncRun("success") }));
    expect(html).not.toContain("hx-trigger=");
  });

  test("i si no acaba mai, es rendeix i ho diu", async () => {
    // Aixo es exactament la importacio interrompuda de la `f80df91`: l'estat
    // no arribara mai a terminal perque no hi ha ningu que l'hi porti.
    const html = String(
      await SyncState({
        connectionId: 4,
        run: syncRun("running"),
        attempt: MAX_ATTEMPTS,
      }),
    );
    expect(html).not.toContain("hx-trigger=");
    expect(html).toContain("S'ha deixat de comprovar");
  });
});

describe("les feines en curs", () => {
  test("mentre n'hi ha, sondeja de manera acotada", async () => {
    const html = String(await Running({ runs: [job()] }));
    expect(html).toContain("hx-trigger=");
    expect(regles(await checkDocument(html, { fragment: true }))).not.toContain(
      "unbounded-poll",
    );
  });

  test("sense cap feina, no sondeja", async () => {
    const html = String(await Running({ runs: [] }));
    expect(html).not.toContain("hx-trigger=");
  });

  test("passat el limit, s'atura i ho diu", async () => {
    const html = String(await Running({ runs: [job()], attempt: MAX_ATTEMPTS }));
    expect(html).not.toContain("hx-trigger=");
    expect(html).toContain("s'ha deixat de comprovar");
  });
});

describe("el limit", () => {
  test("es mitja hora a dos segons, prou per a una importacio de debo", () => {
    expect((MAX_ATTEMPTS * 2) / 60).toBe(30);
  });
});
