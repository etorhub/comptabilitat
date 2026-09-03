/**
 * Flux complet d'autoritzacio: inici, retorn del banc i alta dels comptes.
 *
 * Port de `backend/tests/test_authorization_flow.py`. El banc es un servidor
 * local: cap prova no surt a fora. La clau RS256 es genera al vol, perque el
 * client ha de poder signar el JWT de debò.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  ledgers,
  syncRuns,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { config } from "../src/lib/config.ts";
import { app } from "../src/server.ts";

const CONTRASENYA = "provaprovaprova";

const SESSIO = {
  session_id: "sessio-abc",
  access: { valid_until: "2026-11-20T10:00:00.000Z" },
  aspsp: { name: "Santander", country: "ES" },
  accounts: [
    {
      uid: "uid-1",
      name: "Compte corrent",
      account_id: { iban: "ES9121000418450200051332" },
      currency: "EUR",
      cash_account_type: "CACC",
    },
    {
      uid: "uid-2",
      name: "Compte estalvi",
      account_id: { iban: "ES7620770024003102575766" },
      currency: "EUR",
      cash_account_type: "SVGS",
    },
  ],
};

/** El `config` es `as const` pel tipus, pero els camps es poden tocar. */
const ajustos = config as {
  ebApplicationId: string;
  ebPrivateKey: string;
  ebApiOrigin: string;
  publicBaseUrl: string;
};

let banc: ReturnType<typeof Bun.serve> | undefined;
let calellaId = 0;
let sessioAdmin = { cookie: "", csrf: "" };

async function clauRsaPem(): Promise<string> {
  const parell = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", parell.privateKey);
  const base64 = Buffer.from(pkcs8)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
}

async function entra(email: string): Promise<{ cookie: string; csrf: string }> {
  const getEntrada = await app.request("/entrada");
  const htmlEntrada = await getEntrada.text();
  const seedCookie = (getEntrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const camp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";

  const res = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
    body: new URLSearchParams({ _csrf: camp, email, password: CONTRASENYA }).toString(),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const pagina = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const csrf = /X-CSRF-Token": "([^"]+)"/.exec(await pagina.text())?.[1] ?? "";
  return { cookie, csrf };
}

async function autoritza(
  sessio: { cookie: string; csrf: string },
  cos: Record<string, string>,
): Promise<Response> {
  return app.request("/connexions/autoritza", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessio.cookie,
      "X-CSRF-Token": sessio.csrf,
      "HX-Request": "true",
    },
    body: new URLSearchParams(cos).toString(),
  });
}

async function retornDelBanc(params: Record<string, string>): Promise<Response> {
  return app.request(`/api/auth/callback?${new URLSearchParams(params).toString()}`);
}

async function connexio() {
  const [fila] = await db.select().from(bankConnections).limit(1);
  return fila;
}

beforeAll(async () => {
  banc = Bun.serve({
    port: 0,
    fetch(req) {
      const cami = new URL(req.url).pathname;
      if (cami === "/auth") return Response.json({ url: "https://banc.example/sca?x=1" });
      if (cami === "/sessions") return Response.json(SESSIO);
      return new Response("no", { status: 404 });
    },
  });

  ajustos.ebApplicationId = "app-de-proves";
  ajustos.ebPrivateKey = await clauRsaPem();
  ajustos.ebApiOrigin = `http://127.0.0.1:${banc.port}`;
});

afterAll(async () => {
  await banc?.stop(true);
});

beforeEach(async () => {
  await db.delete(syncRuns);
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const espais = await db
    .insert(ledgers)
    .values(
      ["personal", "calella"].map((code, i) => ({
        code,
        name: code,
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: i,
        isActive: true,
        alertRecipients: [],
      })),
    )
    .returning();
  calellaId = espais.find((e) => e.code === "calella")?.id ?? 0;

  const passwordHash = await hashPassword(CONTRASENYA);
  await db.insert(users).values([
    {
      email: "admin@exemple.cat",
      fullName: "Admin",
      passwordHash,
      isAdmin: true,
      isActive: true,
    },
    {
      email: "anna@exemple.cat",
      fullName: "Anna",
      passwordHash,
      isAdmin: false,
      isActive: true,
    },
  ]);

  sessioAdmin = await entra("admin@exemple.cat");
});

describe("el flux d'autoritzacio", () => {
  test("dona d'alta els comptes, sense espai assignat", async () => {
    const res = await autoritza(sessioAdmin, { aspsp_name: "Santander" });

    // Per HTMX, una redireccio es un 204 amb `HX-Redirect`: la pagina del
    // banc no pot anar dins d'un `<div>`.
    expect(res.status).toBe(204);
    expect(res.headers.get("HX-Redirect")).toBe("https://banc.example/sca?x=1");

    const pendent = await connexio();
    expect(pendent?.status).toBe("pending");
    const estat = pendent?.ebAuthState ?? "";
    expect(estat).not.toBe("");

    const retorn = await retornDelBanc({ code: "codi-1", state: estat });
    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=ok");

    const activa = await connexio();
    expect(activa?.status).toBe("active");
    expect(activa?.ebSessionId).toBe("sessio-abc");
    expect(activa?.validUntil).not.toBeNull();
    expect(activa?.ebAuthState).toBeNull();

    const comptes = await db.select().from(accounts).orderBy(accounts.ebAccountUid);
    expect(comptes.map((c) => c.ebAccountUid)).toEqual(["uid-1", "uid-2"]);
    // Els comptes arriben sense espai: l'assigna l'usuari despres.
    expect(comptes.every((c) => c.ledgerId === null)).toBe(true);
  });

  test("un estat desconegut no crea cap sessio", async () => {
    const retorn = await retornDelBanc({ code: "codi-1", state: "inventat" });

    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=error");
    expect(await connexio()).toBeUndefined();
  });

  test("el banc pot tornar un error", async () => {
    const retorn = await retornDelBanc({ error: "access_denied" });

    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=error");
  });

  test("renovar el consentiment conserva els comptes i el seu espai", async () => {
    await autoritza(sessioAdmin, { aspsp_name: "Santander" });
    const primera = await connexio();
    await retornDelBanc({ code: "codi-1", state: primera?.ebAuthState ?? "" });

    await db
      .update(accounts)
      .set({ ledgerId: calellaId })
      .where(eq(accounts.ebAccountUid, "uid-1"));

    // Segona autoritzacio sobre la mateixa connexio, com quan caduca el consentiment.
    await autoritza(sessioAdmin, { connection_id: String(primera?.id ?? 0) });
    const segona = await connexio();
    await retornDelBanc({ code: "codi-2", state: segona?.ebAuthState ?? "" });

    const comptes = await db.select().from(accounts);
    expect(comptes.length).toBe(2);
    const uid1 = comptes.find((c) => c.ebAccountUid === "uid-1");
    expect(uid1?.ledgerId).toBe(calellaId);
  });
});

describe("qui pot gestionar les connexions", () => {
  test("un usuari normal no en veu res", async () => {
    const anna = await entra("anna@exemple.cat");

    // Aqui hi ha un canvi respecte de l'aplicacio de Python, que responia 403:
    // ara es un 404, com amb els espais. Qui no ho es, no ha de saber que hi ha.
    expect(
      (await app.request("/connexions", { headers: { Cookie: anna.cookie } })).status,
    ).toBe(404);
    expect((await autoritza(anna, {})).status).toBe(404);
    expect(await connexio()).toBeUndefined();
  });
});
