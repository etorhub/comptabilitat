/**
 * The guarantees of watertight workspaces.
 *
 * These tests are a translation of `backend/tests/test_espais.py` and are the
 * most important of all: they check that whoever has no access to a workspace
 * can know nothing about it, not even that it exists.
 *
 * A database is needed. The same one the other tests use:
 *   DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./helpers.ts";
import { db } from "../src/db/client.ts";
import { alerts, ledgers, userLedgerPermissions, users } from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { eq } from "drizzle-orm";

let idCalella = 0;
let calellaAlertId = 0;

beforeAll(async () => {
  // Two workspaces; Pau only has access to the first.
  await db.delete(userLedgerPermissions);
  await db.delete(alerts);
  await db.delete(users);
  await db.delete(ledgers);

  const workspaces = await db
    .insert(ledgers)
    .values([
      {
        code: "personal",
        name: "Personal",
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: 0,
        isActive: true,
        alertRecipients: [],
      },
      {
        code: "calella",
        name: "Calella",
        description: "",
        currency: "EUR",
        color: "#0891b2",
        overdraftThreshold: "0.00",
        position: 1,
        isActive: true,
        alertRecipients: [],
      },
    ])
    .returning();

  const personal = workspaces.find((e) => e.code === "personal");
  const calella = workspaces.find((e) => e.code === "calella");
  if (!personal || !calella) throw new Error("no s'han creat els espais");
  idCalella = calella.id;

  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(users)
    .values([
      {
        email: "pau@exemple.cat",
        fullName: "Pau",
        passwordHash,
        isAdmin: false,
        isActive: true,
      },
      // Installation administrator, but with access to no workspace.
      {
        email: "arrel@exemple.cat",
        fullName: "Arrel",
        passwordHash,
        isAdmin: true,
        isActive: true,
      },
    ])
    .returning();

  const pau = created.find((u) => u.email === "pau@exemple.cat");
  if (!pau) throw new Error("no s'ha creat en Pau");

  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau.id, ledgerId: personal.id, role: "admin" });

  const [alert] = await db
    .insert(alerts)
    .values({
      ledgerId: calella.id,
      type: "sync_failed",
      severity: "warning",
      status: "new",
      dedupKey: "prova-calella",
      title: "Aixo es de Calella",
      body: "",
      payload: {},
    })
    .returning();
  calellaAlertId = alert?.id ?? 0;
});

describe("whoever has no access to a workspace", () => {
  test("gets a 404, not a 403", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("cannot tell a workspace they do not have from one that does not exist", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const withoutAccess = await app.request("/e/calella/avisos", {
      headers: { Cookie: cookie },
    });
    const inexistent = await app.request("/e/inventat/avisos", { headers: { Cookie: cookie } });

    expect(withoutAccess.status).toBe(inexistent.status);
    expect(await withoutAccess.text()).toBe(await inexistent.text());
  });

  test("does not see its name anywhere", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    const html = await res.text();

    expect(html).not.toContain("Calella");
    expect(html).not.toContain("calella");
  });

  test("cannot touch its alerts by guessing the id", async () => {
    const { cookie, csrf } = await signIn("pau@exemple.cat");
    const res = await app.request(`/e/personal/avisos/${calellaAlertId}/descarta`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf, "HX-Request": "true" },
    });

    expect(res.status).toBe(404);

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, calellaAlertId));
    expect(alert?.status).toBe("new");
  });

  test("does not see another workspace's tags", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const withoutAccess = await app.request("/e/calella/etiquetes", {
      headers: { Cookie: cookie },
    });
    const inexistent = await app.request("/e/inventat/etiquetes", {
      headers: { Cookie: cookie },
    });
    expect(withoutAccess.status).toBe(404);
    expect(withoutAccess.status).toBe(inexistent.status);
    expect(await withoutAccess.text()).toBe(await inexistent.text());
  });
});

describe("being an installation administrator", () => {
  test("grants access to no workspace", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");

    // Neither to the one that exists and was not given to them...
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);

    // ...nor to the workspace picker.
    const root = await app.request("/", { headers: { Cookie: cookie } });
    expect(root.headers.get("location")).toBe("/sense-espais");
  });
});

describe("a deactivated workspace", () => {
  test("disappears, even if you had access to it", async () => {
    await db.update(ledgers).set({ isActive: false }).where(eq(ledgers.id, idCalella));
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    await db.update(ledgers).set({ isActive: true }).where(eq(ledgers.id, idCalella));
  });
});
