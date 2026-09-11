/**
 * Pantalla de feines i el seu historial.
 *
 * Comprova la guarda d'administracio (404, no 403), que un administrador pot
 * engegar una feina, i que l'execució queda registrada a `job_runs`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { app } from "../src/server.ts";
import { db } from "../src/db/client.ts";
import {
  categories,
  jobRuns,
  ledgers,
  userLedgerPermissions,
  users,
  userSessions,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { executaFeina } from "../src/services/job-runs.ts";
import { seedCategories } from "../src/services/seed.ts";

const CONTRASENYA = "provaprovaprova";

async function entra(email: string): Promise<{ cookie: string; csrf: string }> {
  const get = await app.request("/entrada");
  const htmlEntrada = await get.text();
  const seed = (get.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";

  const res = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seed },
    body: new URLSearchParams({ _csrf: camp, email, password: CONTRASENYA }).toString(),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const pagina = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const csrf = /X-CSRF-Token": "([^"]+)"/.exec(await pagina.text())?.[1] ?? "";
  return { cookie, csrf };
}

async function esperaTerminal(jobName: string, timeoutMs = 10_000): Promise<void> {
  const inici = Date.now();
  while (Date.now() - inici < timeoutMs) {
    const [fila] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobName, jobName))
      .orderBy(jobRuns.id)
      .limit(1);
    if (fila && fila.status !== "running") return;
    await Bun.sleep(50);
  }
  throw new Error(`La feina ${jobName} no ha acabat a temps`);
}

beforeEach(async () => {
  await db.delete(jobRuns);
  await db.delete(userSessions);
  await db.delete(userLedgerPermissions);
  await db.delete(categories);
  await db.delete(users);
  await db.delete(ledgers);

  const [personal] = await db
    .insert(ledgers)
    .values({
      code: "personal",
      name: "Personal",
      description: "",
      currency: "EUR",
      color: "#2563eb",
      overdraftThreshold: "0.00",
      position: 0,
      isActive: true,
      alertRecipients: [],
    })
    .returning();
  await seedCategories(personal?.id ?? 0);

  const passwordHash = await hashPassword(CONTRASENYA);
  const creats = await db
    .insert(users)
    .values([
      {
        email: "arrel@exemple.cat",
        fullName: "Arrel",
        passwordHash,
        isAdmin: true,
        isActive: true,
      },
      {
        email: "pau@exemple.cat",
        fullName: "Pau",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
    ])
    .returning();

  const pau = creats.find((u) => u.email === "pau@exemple.cat");
  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau?.id ?? 0, ledgerId: personal?.id ?? 0, role: "editor" });
});

describe("la pantalla de feines", () => {
  test("un administrador hi entra i veu agenda, passades i historial", async () => {
    const { cookie } = await entra("arrel@exemple.cat");
    const res = await app.request("/feines", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Passada diaria");
    expect(html).toContain("Agenda i salut");
    expect(html).toContain("Historial");
    expect(html).toContain('id="en-curs"');
    expect(html).toContain('name="feina" value="maintenance"');
    expect(html).toContain('hx-post="/feines"');
    expect(html).not.toContain('hx-trigger="every 2s"');
  });

  test("qui no ho es rep un 404, no un 403", async () => {
    const { cookie, csrf } = await entra("pau@exemple.cat");
    expect((await app.request("/feines", { headers: { Cookie: cookie } })).status).toBe(404);
    expect(
      (await app.request("/feines/fragment/historial", { headers: { Cookie: cookie } })).status,
    ).toBe(404);
    expect(
      (
        await app.request("/feines", {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrf,
            "HX-Request": "true",
          },
          body: new URLSearchParams({ feina: "maintenance" }).toString(),
        })
      ).status,
    ).toBe(404);
  });

  test("una feina desconeguda torna 422", async () => {
    const { cookie, csrf } = await entra("arrel@exemple.cat");
    const res = await app.request("/feines", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ feina: "inexistent" }).toString(),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Aquesta feina no existeix");
  });

  test("engega una feina, la registra i contesta amb toast i fragments", async () => {
    const { cookie, csrf } = await entra("arrel@exemple.cat");
    const res = await app.request("/feines", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ feina: "maintenance" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Reswap")).toBe("none");
    const cos = await res.text();
    expect(cos).toContain("La feina ha començat");
    expect(cos).toContain('id="en-curs"');
    expect(cos).toContain('id="historial-feines"');

    const files = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "maintenance"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]?.trigger).toBe("manual");

    await esperaTerminal("maintenance");
    const [acabada] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "maintenance"));
    expect(acabada?.status).toBe("success");
    expect(acabada?.summary).toContain("sessions");
  });

  test("un segon POST mentre corre torna 409", async () => {
    const { cookie, csrf } = await entra("arrel@exemple.cat");
    await db.insert(jobRuns).values({
      jobName: "maintenance",
      trigger: "manual",
      status: "running",
      parentId: null,
      startedAt: new Date(),
      summary: "",
      error: "",
    });

    const res = await app.request("/feines", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ feina: "maintenance" }).toString(),
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("ja esta corrent");
  });

  test("el fragment d'en curs porta sondeig nomes si n'hi ha", async () => {
    const { cookie } = await entra("arrel@exemple.cat");

    const buit = await app.request("/feines/fragment/en-curs", {
      headers: { Cookie: cookie },
    });
    expect(buit.status).toBe(200);
    expect(await buit.text()).not.toContain('hx-trigger="every 2s"');

    await db.insert(jobRuns).values({
      jobName: "analyze",
      trigger: "scheduled",
      status: "running",
      parentId: null,
      startedAt: new Date(),
      summary: "",
      error: "",
    });

    const corrent = await app.request("/feines/fragment/en-curs", {
      headers: { Cookie: cookie },
    });
    const html = await corrent.text();
    expect(html).toContain('hx-trigger="every 2s"');
    expect(html).toContain("Analisi");
  });

  test("el fragment d'historial respecta els filtres i fa push-url", async () => {
    const { cookie } = await entra("arrel@exemple.cat");
    await db.insert(jobRuns).values([
      {
        jobName: "maintenance",
        trigger: "cli",
        status: "success",
        parentId: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        summary: "ok",
        error: "",
      },
      {
        jobName: "sync",
        trigger: "scheduled",
        status: "failed",
        parentId: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        summary: "",
        error: "boom",
      },
    ]);

    const res = await app.request("/feines/fragment/historial?feina=sync&estat=failed", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Push-Url")).toBe("/feines?feina=sync&estat=failed");
    const html = await res.text();
    expect(html).toContain("Sincronitzacio");
    expect(html).toContain("boom");
    expect(html).toContain("1–1 de 1");
    expect(html).not.toContain(">Manteniment</a>");
  });
});

describe("executaFeina", () => {
  test("registra exit i error", async () => {
    const resum = await executaFeina("classify", "cli", async () => "3 classificats");
    expect(resum).toBe("3 classificats");
    const [ok] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "classify"));
    expect(ok?.status).toBe("success");
    expect(ok?.trigger).toBe("cli");
    expect(ok?.summary).toBe("3 classificats");

    await expect(
      executaFeina("llm", "cli", async () => {
        throw new Error("Ollama caigut");
      }),
    ).rejects.toThrow("Ollama caigut");

    const [ko] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "llm"));
    expect(ko?.status).toBe("failed");
    expect(ko?.error).toContain("Ollama caigut");
  });
});
