/**
 * Imports that are left hanging.
 *
 * The import runs in the background inside the server process. If the
 * container restarts halfway, the `sync_runs` row stays `running` forever:
 * there is nobody who can finish it. And the connections page fragment only
 * stops when the state is terminal, so the page is left **polling every two
 * seconds, forever**, for everyone who looks at it.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import { bankConnections, syncRuns } from "../src/db/schema/index.ts";
import { alreadySyncing, closeOpenImports, closeStuckImports } from "../src/services/sync.ts";
import { maintenanceJob } from "../src/workers/jobs/maintenance.ts";

let connectionId = 0;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function run(state: "running" | "success", startedAt: Date): Promise<number> {
  const [row] = await db
    .insert(syncRuns)
    .values({
      connectionId: connectionId,
      trigger: "manual",
      status: state,
      startedAt: startedAt,
      finishedAt: state === "running" ? null : new Date(),
      accountsSynced: 0,
      transactionsInserted: 0,
      transactionsUpdated: 0,
      error: "",
    })
    .returning();
  return row?.id ?? 0;
}

beforeEach(async () => {
  await db.delete(syncRuns);
  await db.delete(bankConnections);

  const [connection] = await db
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
  connectionId = connection?.id ?? 0;
});

describe("the maintenance", () => {
  test("closes those that have not moved for hours", async () => {
    const dead = await run("running", hoursAgo(5));

    expect(await closeStuckImports()).toBe(1);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, dead));
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.error).toContain("a mitges");
  });

  test("but does not touch those that have just started", async () => {
    const alive = await run("running", hoursAgo(0));

    expect(await closeStuckImports()).toBe(0);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, alive));
    expect(row?.status).toBe("running");
  });

  test("and the maintenance job says so", async () => {
    await run("running", hoursAgo(5));
    expect(await maintenanceJob()).toContain("1 importacions penjades");
  });
});

describe("two imports at once", () => {
  test("with a live one, no other is started", async () => {
    await run("running", hoursAgo(0));
    expect(await alreadySyncing(connectionId)).toBe(true);
  });

  test("a hung one does not block forever", async () => {
    await run("running", hoursAgo(5));
    expect(await alreadySyncing(connectionId)).toBe(false);
  });

  test("nor does one that has already finished", async () => {
    await run("success", hoursAgo(0));
    expect(await alreadySyncing(connectionId)).toBe(false);
  });
});

describe("the server's shutdown", () => {
  test("marks any open ones as interrupted", async () => {
    const open = await run("running", hoursAgo(0));

    expect(await closeOpenImports()).toBe(1);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, open));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("s'ha aturat");
  });
});
