/**
 * Sign-in, CSRF and sessions.
 *
 * The CSRF part is not a translation of any Python test: there was no such
 * defense there. These tests are the net under something new.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { app } from "../src/server.ts";
import { db } from "../src/db/client.ts";
import { userLedgerPermissions, users, userSessions } from "../src/db/schema/index.ts";
import { hashPassword, hashToken, newSessionToken } from "../src/lib/auth.ts";
import { csrfTokenFor } from "../src/lib/csrf.ts";

const PASSWORD = "provaprovaprova";

interface Login {
  seedCookie: string;
  csrfField: string;
}

async function prepareLogin(): Promise<Login> {
  const res = await app.request("/entrada");
  const html = await res.text();
  return {
    seedCookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    csrfField: /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? "",
  };
}

function signInBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

beforeAll(async () => {
  await db.delete(userSessions);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.insert(users).values({
    email: "pau@exemple.cat",
    fullName: "Pau",
    passwordHash: await hashPassword(PASSWORD),
    isAdmin: false,
    isActive: true,
  });
});

describe("CSRF", () => {
  test("with no token, the request is rejected", async () => {
    const { seedCookie } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ email: "pau@exemple.cat", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  test("with a made-up token, the same", async () => {
    const { seedCookie } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ _csrf: "inventat", email: "pau@exemple.cat", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  test("one session's token is no use for another", async () => {
    const other = await csrfTokenFor(hashToken(newSessionToken()));
    const { seedCookie } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ _csrf: other, email: "pau@exemple.cat", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  test("a request from another site is rejected even with a token", async () => {
    const { seedCookie, csrfField } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: seedCookie,
        "Sec-Fetch-Site": "cross-site",
      },
      body: signInBody({ _csrf: csrfField, email: "pau@exemple.cat", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });
});

describe("sign-in", () => {
  test("with the right details, it opens a session", async () => {
    const { seedCookie, csrfField } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ _csrf: csrfField, email: "pau@exemple.cat", password: PASSWORD }),
    });

    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("comptabilitat_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("of the session, the database only holds the digest", async () => {
    const { seedCookie, csrfField } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ _csrf: csrfField, email: "pau@exemple.cat", password: PASSWORD }),
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

  test("a user that does not exist and a wrong password are indistinguishable", async () => {
    // The same seed for both attempts: that way the only thing that changes
    // between the two responses is the email, and any other difference would
    // be a way of guessing who is registered.
    const { seedCookie, csrfField } = await prepareLogin();
    const capçaleres = {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: seedCookie,
    };

    const resDesconegut = await app.request("/entrada", {
      method: "POST",
      headers: capçaleres,
      body: signInBody({
        _csrf: csrfField,
        email: "ningu@exemple.cat",
        password: "el-que-sigui",
      }),
    });

    const resDolenta = await app.request("/entrada", {
      method: "POST",
      headers: capçaleres,
      body: signInBody({
        _csrf: csrfField,
        email: "pau@exemple.cat",
        password: "el-que-sigui",
      }),
    });

    expect(resDesconegut.status).toBe(resDolenta.status);

    const netejaEmail = (s: string) => s.replace(/ningu@exemple\.cat|pau@exemple\.cat/g, "");
    expect(netejaEmail(await resDesconegut.text())).toBe(netejaEmail(await resDolenta.text()));
  });

  test("a deactivated user cannot sign in", async () => {
    await db.insert(users).values({
      email: "fora@exemple.cat",
      fullName: "Fora",
      passwordHash: await hashPassword(PASSWORD),
      isAdmin: false,
      isActive: false,
    });

    const { seedCookie, csrfField } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({ _csrf: csrfField, email: "fora@exemple.cat", password: PASSWORD }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("comptabilitat_session=");
  });
});

describe("protected pages", () => {
  test("with no session, they lead to sign-in keeping where you were going", async () => {
    const res = await app.request("/e/personal/avisos");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/entrada?desti=");
    expect(res.headers.get("location")).toContain(encodeURIComponent("/e/personal/avisos"));
  });

  test("the destination cannot lead to another website", async () => {
    const { seedCookie, csrfField } = await prepareLogin();
    const res = await app.request("/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: seedCookie },
      body: signInBody({
        _csrf: csrfField,
        email: "pau@exemple.cat",
        password: PASSWORD,
        desti: "//maliciós.example.com/",
      }),
    });

    const desti = res.headers.get("location") ?? "";
    expect(desti.startsWith("//")).toBe(false);
    expect(desti).not.toContain("maliciós.example.com");
  });
});
