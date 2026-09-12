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
import { PASSWORD, signIn } from "./ajuda.ts";

const Session = {
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

let bank: ReturnType<typeof Bun.serve> | undefined;
let calellaId = 0;
let adminSession = { cookie: "", csrf: "" };

async function keyRsaPem(): Promise<string> {
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

async function autoritza(
  session: { cookie: string; csrf: string },
  body: Record<string, string>,
): Promise<Response> {
  return app.request("/connexions/autoritza", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookie,
      "X-CSRF-Token": session.csrf,
      "HX-Request": "true",
    },
    body: new URLSearchParams(body).toString(),
  });
}

async function bankCallback(params: Record<string, string>): Promise<Response> {
  return app.request(`/api/auth/callback?${new URLSearchParams(params).toString()}`);
}

async function connection() {
  const [row] = await db.select().from(bankConnections).limit(1);
  return row;
}

beforeAll(async () => {
  bank = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/auth") return Response.json({ url: "https://banc.example/sca?x=1" });
      if (path === "/sessions") return Response.json(Session);
      return new Response("no", { status: 404 });
    },
  });

  ajustos.ebApplicationId = "app-de-proves";
  ajustos.ebPrivateKey = await keyRsaPem();
  ajustos.ebApiOrigin = `http://127.0.0.1:${bank.port}`;
});

afterAll(async () => {
  await bank?.stop(true);
});

beforeEach(async () => {
  await db.delete(syncRuns);
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const workspaces = await db
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
  calellaId = workspaces.find((e) => e.code === "calella")?.id ?? 0;

  const passwordHash = await hashPassword(PASSWORD);
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

  adminSession = await signIn("admin@exemple.cat");
});

describe("el flux d'autoritzacio", () => {
  test("dona d'alta els comptes, sense espai assignat", async () => {
    const res = await autoritza(adminSession, { aspsp_name: "Santander" });

    // Per HTMX, una redireccio es un 204 amb `HX-Redirect`: la pagina del
    // banc no pot anar dins d'un `<div>`.
    expect(res.status).toBe(204);
    expect(res.headers.get("HX-Redirect")).toBe("https://banc.example/sca?x=1");

    const pendent = await connection();
    expect(pendent?.status).toBe("pending");
    const state = pendent?.ebAuthState ?? "";
    expect(state).not.toBe("");

    const retorn = await bankCallback({ code: "codi-1", state: state });
    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=ok");

    const active = await connection();
    expect(active?.status).toBe("active");
    expect(active?.ebSessionId).toBe("sessio-abc");
    expect(active?.validUntil).not.toBeNull();
    expect(active?.ebAuthState).toBeNull();

    const accountList = await db.select().from(accounts).orderBy(accounts.ebAccountUid);
    expect(accountList.map((c) => c.ebAccountUid)).toEqual(["uid-1", "uid-2"]);
    // Els comptes arriben sense espai: l'assigna l'usuari despres.
    expect(accountList.every((c) => c.ledgerId === null)).toBe(true);
  });

  test("un estat desconegut no crea cap sessio", async () => {
    const retorn = await bankCallback({ code: "codi-1", state: "inventat" });

    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=error");
    expect(await connection()).toBeUndefined();
  });

  test("el banc pot tornar un error", async () => {
    const retorn = await bankCallback({ error: "access_denied" });

    expect(retorn.status).toBe(303);
    expect(retorn.headers.get("location")).toContain("estat=error");
  });

  test("renovar el consentiment conserva els comptes i el seu espai", async () => {
    await autoritza(adminSession, { aspsp_name: "Santander" });
    const first = await connection();
    await bankCallback({ code: "codi-1", state: first?.ebAuthState ?? "" });

    await db
      .update(accounts)
      .set({ ledgerId: calellaId })
      .where(eq(accounts.ebAccountUid, "uid-1"));

    // Segona autoritzacio sobre la mateixa connexio, com quan caduca el consentiment.
    await autoritza(adminSession, { connection_id: String(first?.id ?? 0) });
    const segona = await connection();
    await bankCallback({ code: "codi-2", state: segona?.ebAuthState ?? "" });

    const accountList = await db.select().from(accounts);
    expect(accountList.length).toBe(2);
    const uid1 = accountList.find((c) => c.ebAccountUid === "uid-1");
    expect(uid1?.ledgerId).toBe(calellaId);
  });
});

describe("qui pot gestionar les connexions", () => {
  test("un usuari normal no en veu res", async () => {
    const anna = await signIn("anna@exemple.cat");

    // Aqui hi ha un canvi respecte de l'aplicacio de Python, que responia 403:
    // ara es un 404, com amb els espais. Qui no ho es, no ha de saber que hi ha.
    expect(
      (await app.request("/connexions", { headers: { Cookie: anna.cookie } })).status,
    ).toBe(404);
    expect((await autoritza(anna, {})).status).toBe(404);
    expect(await connection()).toBeUndefined();
  });
});
