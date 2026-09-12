/**
 * Jobs screen and its history.
 *
 * It checks the administration guard (404, not 403), that an administrator
 * can start a job, and that the run is recorded in `job_runs`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./helpers.ts";
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
import { runJob } from "../src/services/job-runs.ts";
import { seedCategories } from "../src/services/seed.ts";

async function waitForTerminal(jobName: string, timeoutMs = 10_000): Promise<void> {
  const inici = Date.now();
  while (Date.now() - inici < timeoutMs) {
    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobName, jobName))
      .orderBy(jobRuns.id)
      .limit(1);
    if (row && row.status !== "running") return;
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

  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
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

  const pau = created.find((u) => u.email === "pau@exemple.cat");
  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau?.id ?? 0, ledgerId: personal?.id ?? 0, role: "editor" });
});

describe("the jobs screen", () => {
  test("an administrator gets in and sees the schedule, passes and history", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");
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

  test("whoever is not gets a 404, not a 403", async () => {
    const { cookie, csrf } = await signIn("pau@exemple.cat");
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
          body: new URLSearchParams({ job: "maintenance" }).toString(),
        })
      ).status,
    ).toBe(404);
  });

  test("an unknown job returns 422", async () => {
    const { cookie, csrf } = await signIn("arrel@exemple.cat");
    const res = await app.request("/feines", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ job: "inexistent" }).toString(),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Aquesta feina no existeix");
  });

  test("starts a job, records it and answers with a toast and fragments", async () => {
    const { cookie, csrf } = await signIn("arrel@exemple.cat");
    const res = await app.request("/feines", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ job: "maintenance" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Reswap")).toBe("none");
    const body = await res.text();
    expect(body).toContain("La feina ha començat");
    expect(body).toContain('id="en-curs"');
    expect(body).toContain('id="historial-feines"');

    const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "maintenance"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.trigger).toBe("manual");

    await waitForTerminal("maintenance");
    const [acabada] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "maintenance"));
    expect(acabada?.status).toBe("success");
    expect(acabada?.summary).toContain("sessions");
  });

  test("a second POST while it runs returns 409", async () => {
    const { cookie, csrf } = await signIn("arrel@exemple.cat");
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
      body: new URLSearchParams({ job: "maintenance" }).toString(),
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("ja esta corrent");
  });

  test("the in-progress fragment carries a poll only if there is one", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");

    const empty = await app.request("/feines/fragment/en-curs", {
      headers: { Cookie: cookie },
    });
    expect(empty.status).toBe(200);
    expect(await empty.text()).not.toContain('hx-trigger="every 2s"');

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

  test("the history fragment respects the filters and does a push-url", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");
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

describe("runJob", () => {
  test("records success and failure", async () => {
    const summary = await runJob("classify", "cli", async () => "3 classificats");
    expect(summary).toBe("3 classificats");
    const [ok] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "classify"));
    expect(ok?.status).toBe("success");
    expect(ok?.trigger).toBe("cli");
    expect(ok?.summary).toBe("3 classificats");

    await expect(
      runJob("llm", "cli", async () => {
        throw new Error("Ollama caigut");
      }),
    ).rejects.toThrow("Ollama caigut");

    const [ko] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "llm"));
    expect(ko?.status).toBe("failed");
    expect(ko?.error).toContain("Ollama caigut");
  });
});
