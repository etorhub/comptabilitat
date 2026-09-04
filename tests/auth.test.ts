/**
 * Entrada, CSRF i sessions.
 *
 * El CSRF no es una traduccio de cap prova de Python: alla no n'hi havia cap
 * defensa. Aquestes proves son la xarxa d'una cosa nova.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { db } from "../src/db/client.ts";
import { userLedgerPermissions, users, userSessions } from "../src/db/schema/index.ts";
import { hashPassword, hashToken, newSessionToken } from "../src/lib/auth.ts";
import { csrfTokenFor } from "../src/lib/csrf.ts";

const CONTRASENYA = "provaprovaprova";

interface Entrada {
  seedCookie: string;
  csrfCamp: string;
}

async function preparaEntrada(): Promise<Entrada> {
  const res = await app.request("/entrada");
  const html = await res.text();
  return {
    seedCookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    csrfCamp: /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? "",
  };
}

function cosEntrada(camps: Record<string, string>): string {
  return new URLSearchParams(camps).toString();
}

beforeAll(async () => {
  await db.delete(userSessions);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.insert(users).values({
    email: "pau@exemple.cat",
    fullName: "Pau",
    passwordHash: await hashPassword(CONTRASENYA),
    isAdmin: false,
    isActive: true,
  });
});

describe("CSRF", () => {
  test("sense testimoni, la peticio es rebutja", async () => {
    const { seedCookie } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ email: "pau@exemple.cat", password: CONTRASENYA }),
    });
    expect(res.status).toBe(403);
  });

  test("amb un testimoni inventat, tambe", async () => {
    const { seedCookie } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ _csrf: "inventat", email: "pau@exemple.cat", password: CONTRASENYA }),
    });
    expect(res.status).toBe(403);
  });

  test("el testimoni d'una sessio no serveix per a una altra", async () => {
    const altre = await csrfTokenFor(hashToken(newSessionToken()));
    const { seedCookie } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ _csrf: altre, email: "pau@exemple.cat", password: CONTRASENYA }),
    });
    expect(res.status).toBe(403);
  });

  test("una peticio d'un altre lloc es rebutja encara que dugui testimoni", async () => {
    const { seedCookie, csrfCamp } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: seedCookie,
        "Sec-Fetch-Site": "cross-site",
      },
      body: cosEntrada({ _csrf: csrfCamp, email: "pau@exemple.cat", password: CONTRASENYA }),
    });
    expect(res.status).toBe(403);
  });
});

describe("entrada", () => {
  test("amb les dades bones, obre sessio", async () => {
    const { seedCookie, csrfCamp } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ _csrf: csrfCamp, email: "pau@exemple.cat", password: CONTRASENYA }),
    });

    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("comptabilitat_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("de la sessio, a la base de dades nomes hi ha el resum", async () => {
    const { seedCookie, csrfCamp } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ _csrf: csrfCamp, email: "pau@exemple.cat", password: CONTRASENYA }),
    });

    const token = (res.headers.get("set-cookie") ?? "")
      .split(";")[0]
      ?.replace("comptabilitat_session=", "");
    expect(token).toBeTruthy();

    const sessions = await db.select().from(userSessions);
    const desat = sessions.map((s) => s.tokenHash);
    expect(desat).toContain(hashToken(token as string));
    expect(desat).not.toContain(token);
  });

  test("un usuari que no existeix i una contrasenya dolenta son indistingibles", async () => {
    // La mateixa llavor per als dos intents: aixi l'unica cosa que canvia
    // entre les dues respostes es el correu, i qualsevol altra diferencia
    // seria una manera d'endevinar qui esta donat d'alta.
    const { seedCookie, csrfCamp } = await preparaEntrada();
    const capçaleres = {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: seedCookie,
    };

    const resDesconegut = await app.request("/entrada", {
      method: "POST",
      headers: capçaleres,
      body: cosEntrada({
        _csrf: csrfCamp,
        email: "ningu@exemple.cat",
        password: "el-que-sigui",
      }),
    });

    const resDolenta = await app.request("/entrada", {
      method: "POST",
      headers: capçaleres,
      body: cosEntrada({ _csrf: csrfCamp, email: "pau@exemple.cat", password: "el-que-sigui" }),
    });

    expect(resDesconegut.status).toBe(resDolenta.status);

    const netejaEmail = (s: string) => s.replace(/ningu@exemple\.cat|pau@exemple\.cat/g, "");
    expect(netejaEmail(await resDesconegut.text())).toBe(netejaEmail(await resDolenta.text()));
  });

  test("un usuari desactivat no pot entrar", async () => {
    await db.insert(users).values({
      email: "fora@exemple.cat",
      fullName: "Fora",
      passwordHash: await hashPassword(CONTRASENYA),
      isAdmin: false,
      isActive: false,
    });

    const { seedCookie, csrfCamp } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({ _csrf: csrfCamp, email: "fora@exemple.cat", password: CONTRASENYA }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("comptabilitat_session=");
  });
});

describe("pagines protegides", () => {
  test("sense sessio, porten a l'entrada conservant on anaves", async () => {
    const res = await app.request("/e/personal/avisos");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/entrada?desti=");
    expect(res.headers.get("location")).toContain(encodeURIComponent("/e/personal/avisos"));
  });

  test("el desti no pot portar a un altre lloc web", async () => {
    const { seedCookie, csrfCamp } = await preparaEntrada();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: cosEntrada({
        _csrf: csrfCamp,
        email: "pau@exemple.cat",
        password: CONTRASENYA,
        desti: "//maliciós.example.com/",
      }),
    });

    const desti = res.headers.get("location") ?? "";
    expect(desti.startsWith("//")).toBe(false);
    expect(desti).not.toContain("maliciós.example.com");
  });
});
