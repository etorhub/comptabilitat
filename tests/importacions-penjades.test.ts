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

function faHores(hores: number): Date {
  return new Date(Date.now() - hores * 60 * 60 * 1000);
}

async function run(state: "running" | "success", començada: Date): Promise<number> {
  const [row] = await db
    .insert(syncRuns)
    .values({
      connectionId: connectionId,
      trigger: "manual",
      status: state,
      startedAt: començada,
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

describe("el manteniment", () => {
  test("tanca les que fa hores que no es mouen", async () => {
    const morta = await run("running", faHores(5));

    expect(await closeStuckImports()).toBe(1);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, morta));
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.error).toContain("a mitges");
  });

  test("pero no toca les que acaben de començar", async () => {
    const viva = await run("running", faHores(0));

    expect(await closeStuckImports()).toBe(0);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, viva));
    expect(row?.status).toBe("running");
  });

  test("i la feina de manteniment ho diu", async () => {
    await run("running", faHores(5));
    expect(await maintenanceJob()).toContain("1 importacions penjades");
  });
});

describe("dues importacions alhora", () => {
  test("amb una de viva, no se'n comença cap altra", async () => {
    await run("running", faHores(0));
    expect(await alreadySyncing(connectionId)).toBe(true);
  });

  test("una de penjada no bloqueja per sempre", async () => {
    await run("running", faHores(5));
    expect(await alreadySyncing(connectionId)).toBe(false);
  });

  test("ni una que ja ha acabat", async () => {
    await run("success", faHores(0));
    expect(await alreadySyncing(connectionId)).toBe(false);
  });
});

describe("l'aturada del servidor", () => {
  test("marca com a interrompudes les que hi hagi obertes", async () => {
    const oberta = await run("running", faHores(0));

    expect(await closeOpenImports()).toBe(1);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, oberta));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("s'ha aturat");
  });
});
