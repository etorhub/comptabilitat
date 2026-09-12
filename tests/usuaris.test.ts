/**
 * Users and access.
 *
 * The test that matters most in this file is the last one: that the guard on
 * the administration screen **closes off only the administration screen**. An
 * `app.route("/", admin)` with a `use("*")` inside applies the guard to the
 * whole application and locks non-administrators out of the program; it
 * happened, and it cannot be seen if every test signs in as an administrator.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { app } from "../src/server.ts";
import { PASSWORD, signIn } from "./ajuda.ts";
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

let idPersonal = 0;

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
  idPersonal = personal?.id ?? 0;
  await seedCategories(idPersonal);

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

  // Pau is not an administrator, but does have access to a workspace.
  const pau = created.find((u) => u.email === "pau@exemple.cat");
  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau?.id ?? 0, ledgerId: idPersonal, role: "editor" });
});

describe("la pantalla d'usuaris", () => {
  test("un administrador hi entra", async () => {
    const { cookie } = await signIn("arrel@exemple.cat");
    const res = await app.request("/usuaris", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  test("qui no ho es rep un 404, no un 403", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/usuaris", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("la guarda d'administracio no tanca la resta del programa", () => {
  test("qui no es administrador continua entrant al seu espai", async () => {
    const { cookie } = await signIn("pau@exemple.cat");

    for (const path of [
      "/e/personal",
      "/e/personal/moviments",
      "/e/personal/recurrents",
      "/e/personal/informes",
      "/e/personal/previsio",
    ]) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect({ path, state: res.status }).toEqual({ path, state: 200 });
    }
  });

  test("i tambe a les seves pagines de fora dels espais", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const res = await app.request("/contrasenya", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});

describe("la configuracio de l'espai nomes per a administradors", () => {
  const configPaths = [
    "/e/personal/configuracio",
    "/e/personal/categories",
    "/e/personal/etiquetes",
    "/e/personal/avisos",
  ];

  test("qui no ho es rep un 404 a cada ruta", async () => {
    const { cookie } = await signIn("pau@exemple.cat");

    for (const path of configPaths) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect({ path, state: res.status }).toEqual({ path, state: 404 });
    }
  });

  test("no veu la seccio Configuracio a la barra", async () => {
    const { cookie } = await signIn("pau@exemple.cat");
    const html = await (
      await app.request("/e/personal", { headers: { Cookie: cookie } })
    ).text();
    const bar = html.slice(0, html.indexOf('id="contingut"'));

    expect(bar).not.toContain(">Configuracio</h2>");
    expect(bar).not.toContain(">Administracio</h2>");
    expect(bar).not.toContain("/e/personal/categories");
    expect(bar).not.toContain("/e/personal/avisos");
  });

  test("un administrador amb acces hi entra i veu les seccions", async () => {
    const [root] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    await db.insert(userLedgerPermissions).values({
      userId: root?.id ?? 0,
      ledgerId: idPersonal,
      role: "admin",
    });

    const { cookie } = await signIn("arrel@exemple.cat");

    for (const path of configPaths) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect({ path, state: res.status }).toEqual({ path, state: 200 });
    }

    const html = await (
      await app.request("/e/personal", { headers: { Cookie: cookie } })
    ).text();
    const idxConfig = html.indexOf(">Configuracio</h2>");
    const idxAdmin = html.indexOf(">Administracio</h2>");
    expect(idxConfig).toBeGreaterThan(-1);
    expect(idxAdmin).toBeGreaterThan(-1);
    expect(idxConfig).toBeLessThan(idxAdmin);

    expect(html).toContain("/e/personal/configuracio");
    expect(html).toContain(">Espai</span>");
    expect(html).toContain("/e/personal/categories");
    expect(html).toContain("/e/personal/etiquetes");
    expect(html).toContain("/e/personal/avisos");
    expect(html).not.toContain("/e/personal/comercos");
    expect(html).not.toContain("/e/personal/actors");
    expect(html).not.toContain("/e/personal/regles");
    expect(html).toContain("/connexions");
    expect(html).toContain("/feines");
    expect(html).toContain("/usuaris");
  });
});

describe("donar acces a un espai", () => {
  test("no en te fins que algu l'hi dona", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const [fresh] = await db
      .insert(users)
      .values({
        email: "sogra@exemple.cat",
        fullName: "Sogra",
        passwordHash,
        isAdmin: false,
        isActive: true,
      })
      .returning();

    const session = await signIn("sogra@exemple.cat");
    expect(
      (await app.request("/e/personal", { headers: { Cookie: session.cookie } })).status,
    ).toBe(404);

    // The administrator gives them one.
    const admin = await signIn("arrel@exemple.cat");
    const res = await app.request(`/usuaris/${fresh?.id}/acces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ ledger_id: String(idPersonal), role: "viewer" }).toString(),
    });
    expect(res.status).toBe(200);

    // And now yes.
    expect(
      (await app.request("/e/personal", { headers: { Cookie: session.cookie } })).status,
    ).toBe(200);
  });

  test("treure'l el torna a deixar fora", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const session = await signIn("pau@exemple.cat");
    const admin = await signIn("arrel@exemple.cat");

    await app.request(`/usuaris/${pau?.id}/acces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ ledger_id: String(idPersonal), role: "" }).toString(),
    });

    expect(
      (await app.request("/e/personal", { headers: { Cookie: session.cookie } })).status,
    ).toBe(404);
  });
});

describe("desactivar un usuari", () => {
  test("li tanca les sessions obertes", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const session = await signIn("pau@exemple.cat");
    expect(
      (await app.request("/contrasenya", { headers: { Cookie: session.cookie } })).status,
    ).toBe(200);

    const admin = await signIn("arrel@exemple.cat");
    await app.request(`/usuaris/${pau?.id}/estat`, {
      method: "POST",
      headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "HX-Request": "true" },
    });

    // The session is no longer valid: back to the sign-in page.
    const res = await app.request("/contrasenya", { headers: { Cookie: session.cookie } });
    expect(res.status).toBe(303);
  });

  test("un administrador no es pot desactivar ell mateix", async () => {
    const [root] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    const admin = await signIn("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${root?.id}/estat`, {
      method: "POST",
      headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "HX-Request": "true" },
    });
    expect(res.status).toBe(422);

    const [encara] = await db
      .select()
      .from(users)
      .where(eq(users.id, root?.id ?? 0));
    expect(encara?.isActive).toBe(true);
  });
});

describe("editar un usuari", () => {
  test("canvia el nom i el rol d'instal·lacio", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const admin = await signIn("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${pau?.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ full_name: "Pau Actualitzat", is_admin: "on" }).toString(),
    });
    expect(res.status).toBe(200);

    const [actualitzat] = await db
      .select()
      .from(users)
      .where(eq(users.id, pau?.id ?? 0));
    expect(actualitzat?.fullName).toBe("Pau Actualitzat");
    expect(actualitzat?.isAdmin).toBe(true);
  });

  test("un administrador no es pot treure a ell mateix l'admin", async () => {
    const [root] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    const admin = await signIn("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${root?.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ full_name: "Arrel" }).toString(),
    });
    expect(res.status).toBe(422);

    const [encara] = await db
      .select()
      .from(users)
      .where(eq(users.id, root?.id ?? 0));
    expect(encara?.isAdmin).toBe(true);
  });
});

describe("reiniciar la contrasenya", () => {
  test("li tanca les sessions i deixa entrar amb la nova", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const session = await signIn("pau@exemple.cat");
    const admin = await signIn("arrel@exemple.cat");

    const newPassword = "contrasenya-nova-llarga";
    const res = await app.request(`/usuaris/${pau?.id}/contrasenya`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ password: newPassword }).toString(),
    });
    expect(res.status).toBe(200);

    // The old session is no longer valid.
    expect(
      (await app.request("/contrasenya", { headers: { Cookie: session.cookie } })).status,
    ).toBe(303);

    // And they can sign in with the new one.
    const get = await app.request("/entrada");
    const loginHtml = await get.text();
    const seed = (get.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const field = /name="_csrf" value="([^"]+)"/.exec(loginHtml)?.[1] ?? "";
    const login = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seed },
      body: new URLSearchParams({
        _csrf: field,
        email: "pau@exemple.cat",
        password: newPassword,
      }).toString(),
    });
    expect(login.status).toBe(303);
  });

  test("una massa curta torna errors al formulari", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const admin = await signIn("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${pau?.id}/contrasenya`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ password: "curta" }).toString(),
    });
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain("camp-error");
  });
});
