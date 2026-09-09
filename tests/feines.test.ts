/**
 * Pantalla de feines manuals.
 *
 * Comprova la guarda d'administracio (404, no 403) i que un administrador
 * pot engegar una feina des de la UI.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { db } from "../src/db/client.ts";
import {
  categories,
  ledgers,
  userLedgerPermissions,
  users,
  userSessions,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
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

beforeEach(async () => {
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
  test("un administrador hi entra i veu les passades", async () => {
    const { cookie } = await entra("arrel@exemple.cat");
    const res = await app.request("/feines", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Passada diaria");
    expect(html).toContain('name="feina" value="maintenance"');
    expect(html).toContain('hx-post="/feines"');
  });

  test("qui no ho es rep un 404, no un 403", async () => {
    const { cookie, csrf } = await entra("pau@exemple.cat");
    expect((await app.request("/feines", { headers: { Cookie: cookie } })).status).toBe(404);
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

  test("engega una feina i contesta amb un toast", async () => {
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
    expect(await res.text()).toContain("La feina ha començat");
  });
});
