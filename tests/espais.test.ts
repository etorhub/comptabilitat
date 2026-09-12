/**
 * Les garanties dels espais estancs.
 *
 * Aquestes proves son la traduccio de `backend/tests/test_espais.py` i son les
 * mes importants de totes: comproven que qui no te acces a un espai no en pot
 * saber res, ni tan sols que existeix.
 *
 * Cal una base de dades. La mateixa que fan servir les altres proves:
 *   DATABASE_URL=postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat_test
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./ajuda.ts";
import { db } from "../src/db/client.ts";
import { alerts, ledgers, userLedgerPermissions, users } from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { eq } from "drizzle-orm";

let idCalella = 0;
let calellaAlertId = 0;

beforeAll(async () => {
  // Dos espais; en Pau nomes te acces al primer.
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
      // Administrador de la instal·lacio, pero sense acces a cap espai.
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

describe("qui no te acces a un espai", () => {
  test("rep un 404, no un 403", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("no distingeix un espai que no te d'un que no existeix", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const withoutAccess = await app.request("/e/calella/avisos", {
      headers: { Cookie: cookie },
    });
    const inexistent = await app.request("/e/inventat/avisos", { headers: { Cookie: cookie } });

    expect(withoutAccess.status).toBe(inexistent.status);
    expect(await withoutAccess.text()).toBe(await inexistent.text());
  });

  test("no en veu el nom enlloc", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    const html = await res.text();

    expect(html).not.toContain("Calella");
    expect(html).not.toContain("calella");
  });

  test("no en pot tocar els avisos endevinant-ne l'identificador", async () => {
    const { cookie, csrf } = await signIn("pau@exemple.cat");
    const res = await app.request(`/e/personal/avisos/${calellaAlertId}/descarta`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf, "HX-Request": "true" },
    });

    expect(res.status).toBe(404);

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, calellaAlertId));
    expect(alert?.status).toBe("new");
  });

  test("no veu les etiquetes d'un espai aliè", async () => {
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

describe("ser administrador de la instal·lacio", () => {
  test("no dona acces a cap espai", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");

    // Ni al que existeix i no li han donat...
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);

    // ...ni al selector d'espais.
    const root = await app.request("/", { headers: { Cookie: cookie } });
    expect(root.headers.get("location")).toBe("/sense-espais");
  });
});

describe("un espai desactivat", () => {
  test("desapareix, encara que hi tinguessis acces", async () => {
    await db.update(ledgers).set({ isActive: false }).where(eq(ledgers.id, idCalella));
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    await db.update(ledgers).set({ isActive: true }).where(eq(ledgers.id, idCalella));
  });
});
