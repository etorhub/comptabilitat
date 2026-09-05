/**
 * Importacions que es queden penjades.
 *
 * La importacio corre en segon pla dins del proces del servidor. Si el
 * contenidor es reinicia enmig, la fila de `sync_runs` es queda en `running`
 * per sempre: no hi ha ningu que la pugui acabar. I el fragment de la pagina
 * de connexions nomes s'atura quan l'estat es terminal, de manera que la
 * pagina es queda **sondejant cada dos segons, per sempre**, per a tothom qui
 * la miri.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import { bankConnections, syncRuns } from "../src/db/schema/index.ts";
import {
  jaSincronitza,
  tancaImportacionsObertes,
  tancaImportacionsPenjades,
} from "../src/services/sync.ts";
import { feinaManteniment } from "../src/workers/jobs/maintenance.ts";

let connexioId = 0;

function faHores(hores: number): Date {
  return new Date(Date.now() - hores * 60 * 60 * 1000);
}

async function execucio(estat: "running" | "success", començada: Date): Promise<number> {
  const [fila] = await db
    .insert(syncRuns)
    .values({
      connectionId: connexioId,
      trigger: "manual",
      status: estat,
      startedAt: començada,
      finishedAt: estat === "running" ? null : new Date(),
      accountsSynced: 0,
      transactionsInserted: 0,
      transactionsUpdated: 0,
      error: "",
    })
    .returning();
  return fila?.id ?? 0;
}

beforeEach(async () => {
  await db.delete(syncRuns);
  await db.delete(bankConnections);

  const [connexio] = await db
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
  connexioId = connexio?.id ?? 0;
});

describe("el manteniment", () => {
  test("tanca les que fa hores que no es mouen", async () => {
    const morta = await execucio("running", faHores(5));

    expect(await tancaImportacionsPenjades()).toBe(1);

    const [fila] = await db.select().from(syncRuns).where(eq(syncRuns.id, morta));
    expect(fila?.status).toBe("failed");
    expect(fila?.finishedAt).not.toBeNull();
    expect(fila?.error).toContain("a mitges");
  });

  test("pero no toca les que acaben de començar", async () => {
    const viva = await execucio("running", faHores(0));

    expect(await tancaImportacionsPenjades()).toBe(0);

    const [fila] = await db.select().from(syncRuns).where(eq(syncRuns.id, viva));
    expect(fila?.status).toBe("running");
  });

  test("i la feina de manteniment ho diu", async () => {
    await execucio("running", faHores(5));
    expect(await feinaManteniment()).toContain("1 importacions penjades");
  });
});

describe("dues importacions alhora", () => {
  test("amb una de viva, no se'n comença cap altra", async () => {
    await execucio("running", faHores(0));
    expect(await jaSincronitza(connexioId)).toBe(true);
  });

  test("una de penjada no bloqueja per sempre", async () => {
    await execucio("running", faHores(5));
    expect(await jaSincronitza(connexioId)).toBe(false);
  });

  test("ni una que ja ha acabat", async () => {
    await execucio("success", faHores(0));
    expect(await jaSincronitza(connexioId)).toBe(false);
  });
});

describe("l'aturada del servidor", () => {
  test("marca com a interrompudes les que hi hagi obertes", async () => {
    const oberta = await execucio("running", faHores(0));

    expect(await tancaImportacionsObertes()).toBe(1);

    const [fila] = await db.select().from(syncRuns).where(eq(syncRuns.id, oberta));
    expect(fila?.status).toBe("failed");
    expect(fila?.error).toContain("s'ha aturat");
  });
});
