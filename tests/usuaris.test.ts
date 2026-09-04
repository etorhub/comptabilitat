/**
 * Usuaris i acces.
 *
 * La prova que mes importa d'aquest fitxer es la ultima: que la guarda de la
 * pantalla d'administracio **nomes tanqui la pantalla d'administracio**. Un
 * `app.route("/", admin)` amb un `use("*")` a dins aplica la guarda a tota
 * l'aplicacio i deixa fora del programa qui no sigui administrador; va passar,
 * i no es veu si totes les proves entren com a administrador.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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

  // En Pau no es administrador, pero si que te acces a un espai.
  const pau = creats.find((u) => u.email === "pau@exemple.cat");
  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau?.id ?? 0, ledgerId: idPersonal, role: "editor" });
});

describe("la pantalla d'usuaris", () => {
  test("un administrador hi entra", async () => {
    const { cookie } = await entra("arrel@exemple.cat");
    const res = await app.request("/usuaris", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  test("qui no ho es rep un 404, no un 403", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const res = await app.request("/usuaris", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("la guarda d'administracio no tanca la resta del programa", () => {
  test("qui no es administrador continua entrant al seu espai", async () => {
    const { cookie } = await entra("pau@exemple.cat");

    for (const cami of [
      "/e/personal",
      "/e/personal/moviments",
      "/e/personal/recurrents",
      "/e/personal/informes",
      "/e/personal/previsio",
    ]) {
      const res = await app.request(cami, { headers: { Cookie: cookie } });
      expect({ cami, estat: res.status }).toEqual({ cami, estat: 200 });
    }
  });

  test("i tambe a les seves pagines de fora dels espais", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const res = await app.request("/contrasenya", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});

describe("la configuracio de l'espai nomes per a administradors", () => {
  const caminsConfig = [
    "/e/personal/configuracio",
    "/e/personal/categories",
    "/e/personal/etiquetes",
    "/e/personal/comercos",
    "/e/personal/regles",
    "/e/personal/avisos",
  ];

  test("qui no ho es rep un 404 a cada ruta", async () => {
    const { cookie } = await entra("pau@exemple.cat");

    for (const cami of caminsConfig) {
      const res = await app.request(cami, { headers: { Cookie: cookie } });
      expect({ cami, estat: res.status }).toEqual({ cami, estat: 404 });
    }
  });

  test("no veu la seccio Configuracio a la barra", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const html = await (await app.request("/e/personal", { headers: { Cookie: cookie } })).text();
    const barra = html.slice(0, html.indexOf('id="contingut"'));

    expect(barra).not.toContain(">Configuracio</h2>");
    expect(barra).not.toContain(">Administracio</h2>");
    expect(barra).not.toContain("/e/personal/categories");
    expect(barra).not.toContain("/e/personal/avisos");
  });

  test("un administrador amb acces hi entra i veu les seccions", async () => {
    const [arrel] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    await db.insert(userLedgerPermissions).values({
      userId: arrel?.id ?? 0,
      ledgerId: idPersonal,
      role: "admin",
    });

    const { cookie } = await entra("arrel@exemple.cat");

    for (const cami of caminsConfig) {
      const res = await app.request(cami, { headers: { Cookie: cookie } });
      expect({ cami, estat: res.status }).toEqual({ cami, estat: 200 });
    }

    const html = await (await app.request("/e/personal", { headers: { Cookie: cookie } })).text();
    const idxConfig = html.indexOf(">Configuracio</h2>");
    const idxAdmin = html.indexOf(">Administracio</h2>");
    expect(idxConfig).toBeGreaterThan(-1);
    expect(idxAdmin).toBeGreaterThan(-1);
    expect(idxConfig).toBeLessThan(idxAdmin);

    expect(html).toContain("/e/personal/configuracio");
    expect(html).toContain(">Espai</span>");
    expect(html).toContain("/e/personal/categories");
    expect(html).toContain("/e/personal/etiquetes");
    expect(html).toContain("/e/personal/comercos");
    expect(html).toContain("/e/personal/regles");
    expect(html).toContain("/e/personal/avisos");
    expect(html).toContain("/connexions");
    expect(html).toContain("/usuaris");
  });
});

describe("donar acces a un espai", () => {
  test("no en te fins que algu l'hi dona", async () => {
    const passwordHash = await hashPassword(CONTRASENYA);
    const [nou] = await db
      .insert(users)
      .values({
        email: "sogra@exemple.cat",
        fullName: "Sogra",
        passwordHash,
        isAdmin: false,
        isActive: true,
      })
      .returning();

    const sessio = await entra("sogra@exemple.cat");
    expect(
      (await app.request("/e/personal", { headers: { Cookie: sessio.cookie } })).status,
    ).toBe(404);

    // L'administrador li'n dona.
    const admin = await entra("arrel@exemple.cat");
    const res = await app.request(`/usuaris/${nou?.id}/acces`, {
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

    // I ara si.
    expect(
      (await app.request("/e/personal", { headers: { Cookie: sessio.cookie } })).status,
    ).toBe(200);
  });

  test("treure'l el torna a deixar fora", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const sessio = await entra("pau@exemple.cat");
    const admin = await entra("arrel@exemple.cat");

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
      (await app.request("/e/personal", { headers: { Cookie: sessio.cookie } })).status,
    ).toBe(404);
  });
});

describe("desactivar un usuari", () => {
  test("li tanca les sessions obertes", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const sessio = await entra("pau@exemple.cat");
    expect(
      (await app.request("/contrasenya", { headers: { Cookie: sessio.cookie } })).status,
    ).toBe(200);

    const admin = await entra("arrel@exemple.cat");
    await app.request(`/usuaris/${pau?.id}/estat`, {
      method: "POST",
      headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "HX-Request": "true" },
    });

    // La sessio ja no val: torna a l'entrada.
    const res = await app.request("/contrasenya", { headers: { Cookie: sessio.cookie } });
    expect(res.status).toBe(303);
  });

  test("un administrador no es pot desactivar ell mateix", async () => {
    const [arrel] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    const admin = await entra("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${arrel?.id}/estat`, {
      method: "POST",
      headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "HX-Request": "true" },
    });
    expect(res.status).toBe(422);

    const [encara] = await db
      .select()
      .from(users)
      .where(eq(users.id, arrel?.id ?? 0));
    expect(encara?.isActive).toBe(true);
  });
});

describe("editar un usuari", () => {
  test("canvia el nom i el rol d'instal·lacio", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const admin = await entra("arrel@exemple.cat");

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
    const [arrel] = await db.select().from(users).where(eq(users.email, "arrel@exemple.cat"));
    const admin = await entra("arrel@exemple.cat");

    const res = await app.request(`/usuaris/${arrel?.id}`, {
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
      .where(eq(users.id, arrel?.id ?? 0));
    expect(encara?.isAdmin).toBe(true);
  });
});

describe("reiniciar la contrasenya", () => {
  test("li tanca les sessions i deixa entrar amb la nova", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const sessio = await entra("pau@exemple.cat");
    const admin = await entra("arrel@exemple.cat");

    const nova = "contrasenya-nova-llarga";
    const res = await app.request(`/usuaris/${pau?.id}/contrasenya`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: admin.cookie,
        "X-CSRF-Token": admin.csrf,
        "HX-Request": "true",
      },
      body: new URLSearchParams({ password: nova }).toString(),
    });
    expect(res.status).toBe(200);

    // La sessio antiga ja no val.
    expect(
      (await app.request("/contrasenya", { headers: { Cookie: sessio.cookie } })).status,
    ).toBe(303);

    // I pot entrar amb la nova.
    const get = await app.request("/entrada");
    const htmlEntrada = await get.text();
    const seed = (get.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";
    const login = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seed },
      body: new URLSearchParams({
        _csrf: camp,
        email: "pau@exemple.cat",
        password: nova,
      }).toString(),
    });
    expect(login.status).toBe(303);
  });

  test("una massa curta torna errors al formulari", async () => {
    const [pau] = await db.select().from(users).where(eq(users.email, "pau@exemple.cat"));
    const admin = await entra("arrel@exemple.cat");

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
    const cos = await res.text();
    expect(cos).toContain("camp-error");
  });
});
