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
import { db } from "../src/db/client.ts";
import { alerts, ledgers, userLedgerPermissions, users } from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { eq } from "drizzle-orm";

const CONTRASENYA = "provaprovaprova";

interface Sessio {
  cookie: string;
  csrf: string;
}

/** Entra i torna la galeta de sessio i el testimoni CSRF que li correspon. */
async function entra(email: string): Promise<Sessio> {
  const getEntrada = await app.request("/entrada");
  const htmlEntrada = await getEntrada.text();
  const llavor = getEntrada.headers.get("set-cookie") ?? "";
  const seedCookie = llavor.split(";")[0] ?? "";
  const csrfCamp = /name="_csrf" value="([^"]+)"/.exec(htmlEntrada)?.[1] ?? "";

  const res = await app.request("/entrada", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: seedCookie,
    },
    body: new URLSearchParams({ _csrf: csrfCamp, email, password: CONTRASENYA }).toString(),
  });

  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";

  // El testimoni CSRF de la sessio surt al `hx-headers` de qualsevol pagina.
  const pagina = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const csrf = /X-CSRF-Token": "([^"]+)"/.exec(await pagina.text())?.[1] ?? "";

  return { cookie, csrf };
}

let idCalella = 0;
let idAvisCalella = 0;

beforeAll(async () => {
  // Dos espais; en Pau nomes te acces al primer.
  await db.delete(userLedgerPermissions);
  await db.delete(alerts);
  await db.delete(users);
  await db.delete(ledgers);

  const espais = await db
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

  const personal = espais.find((e) => e.code === "personal");
  const calella = espais.find((e) => e.code === "calella");
  if (!personal || !calella) throw new Error("no s'han creat els espais");
  idCalella = calella.id;

  const passwordHash = await hashPassword(CONTRASENYA);
  const creats = await db
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

  const pau = creats.find((u) => u.email === "pau@exemple.cat");
  if (!pau) throw new Error("no s'ha creat en Pau");

  await db
    .insert(userLedgerPermissions)
    .values({ userId: pau.id, ledgerId: personal.id, role: "admin" });

  const [avis] = await db
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
  idAvisCalella = avis?.id ?? 0;
});

describe("qui no te acces a un espai", () => {
  test("rep un 404, no un 403", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("no distingeix un espai que no te d'un que no existeix", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const senseAcces = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    const inexistent = await app.request("/e/inventat/avisos", { headers: { Cookie: cookie } });

    expect(senseAcces.status).toBe(inexistent.status);
    expect(await senseAcces.text()).toBe(await inexistent.text());
  });

  test("no en veu el nom enlloc", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    const html = await res.text();

    expect(html).not.toContain("Calella");
    expect(html).not.toContain("calella");
  });

  test("no en pot tocar els avisos endevinant-ne l'identificador", async () => {
    const { cookie, csrf } = await entra("pau@exemple.cat");
    const res = await app.request(`/e/personal/avisos/${idAvisCalella}/descarta`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf, "HX-Request": "true" },
    });

    expect(res.status).toBe(404);

    const [avis] = await db.select().from(alerts).where(eq(alerts.id, idAvisCalella));
    expect(avis?.status).toBe("new");
  });

  test("no veu les etiquetes d'un espai aliè", async () => {
    const { cookie } = await entra("pau@exemple.cat");
    const senseAcces = await app.request("/e/calella/etiquetes", {
      headers: { Cookie: cookie },
    });
    const inexistent = await app.request("/e/inventat/etiquetes", {
      headers: { Cookie: cookie },
    });
    expect(senseAcces.status).toBe(404);
    expect(senseAcces.status).toBe(inexistent.status);
    expect(await senseAcces.text()).toBe(await inexistent.text());
  });
});

describe("ser administrador de la instal·lacio", () => {
  test("no dona acces a cap espai", async () => {
    const { cookie } = await entra("arrel@exemple.cat");

    // Ni al que existeix i no li han donat...
    const res = await app.request("/e/personal/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);

    // ...ni al selector d'espais.
    const arrel = await app.request("/", { headers: { Cookie: cookie } });
    expect(arrel.headers.get("location")).toBe("/sense-espais");
  });
});

describe("un espai desactivat", () => {
  test("desapareix, encara que hi tinguessis acces", async () => {
    await db.update(ledgers).set({ isActive: false }).where(eq(ledgers.id, idCalella));
    const { cookie } = await entra("pau@exemple.cat");
    const res = await app.request("/e/calella/avisos", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    await db.update(ledgers).set({ isActive: true }).where(eq(ledgers.id, idCalella));
  });
});
