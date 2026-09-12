/**
 * The application's two polls, and the fact that they stop.
 *
 * The bug (`f80df91`) was this: an interrupted import left the row `running`
 * forever, and since the fragment only stopped polling when the state was
 * terminal, the page asked for it every two seconds indefinitely, for
 * everyone who looked at it.
 *
 * What is checked here is not «it polls», but **that it gives up**.
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

// No `as`: the type comes from the Drizzle table, and if a new column ever
// shows up there it is better that this breaks here than that we draw a row
// that does not look like the real ones.
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
    // This is exactly the interrupted import of `f80df91`: the state will
    // never reach terminal because there is nobody to take it there.
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
