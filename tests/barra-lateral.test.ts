/**
 * La barra lateral i el `#toast`.
 *
 * Dues coses que el full d'estil sabia dibuixar i cap plantilla no demanava
 * mai:
 *
 *   - `.menu a[aria-current="page"]` tenia el seu fons des del primer dia i
 *     l'atribut no l'escrivia ningu: la barra no deia on eres, ni de color ni
 *     a un lector de pantalla.
 *   - El `#toast` naixia amb `aria-live="polite"` i el primer avis el
 *     substituia per un `<div id="toast">` sense l'atribut, de manera que a
 *     partir d'aquell moment ja no hi havia cap regio viva. Ara es canvia el
 *     **contingut** del `#toast` i el contenidor no es mou mai.
 */

import { describe, expect, test } from "bun:test";

import { Layout } from "../src/components/layout.ts";
import { clearToast, toast } from "../src/lib/http.ts";
import type { Ledger, LedgerRole, User } from "../src/db/schema/index.ts";

const usuari = {
  id: 1,
  email: "algu@exemple.cat",
  fullName: "Algu",
  isAdmin: true,
  isActive: true,
} as User;

const espai = { id: 7, code: "personal", name: "Personal" } as Ledger;
const espais = [{ ...espai, role: "owner" as LedgerRole } as Ledger & { role: LedgerRole }];

async function barra(ruta: string): Promise<string> {
  return String(
    await Layout({
      titol: "Prova",
      user: usuari,
      csrfToken: "x",
      espais,
      espai,
      ruta,
      children: "",
    }),
  );
}

/** L'`href` de l'enllaç marcat com a pagina actual. */
function marcat(pagina: string): string[] {
  return [...pagina.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1] ?? "");
}

describe("aria-current a la barra lateral", () => {
  test("marca la pagina que s'esta mirant, i nomes una", async () => {
    expect(marcat(await barra("/e/personal/moviments"))).toEqual(["/e/personal/moviments"]);
    // I els del grup de configuracio, que el master va moure a part.
    expect(marcat(await barra("/e/personal/etiquetes"))).toEqual(["/e/personal/etiquetes"]);
    expect(marcat(await barra("/e/personal/categories"))).toEqual(["/e/personal/categories"]);
  });

  test("guanya el cami mes llarg, no el primer que encaixa", async () => {
    // «Panell» es `/e/personal`, que es el començament de tots els altres.
    expect(marcat(await barra("/e/personal/avisos"))).toEqual(["/e/personal/avisos"]);
    // I «Moviments» ho es de «Per revisar».
    expect(marcat(await barra("/e/personal/moviments/revisio"))).toEqual([
      "/e/personal/moviments/revisio",
    ]);
    // El panell, a la seva, si que es marca.
    expect(marcat(await barra("/e/personal"))).toEqual(["/e/personal"]);
  });

  test("tambe a les pantalles d'administracio", async () => {
    expect(marcat(await barra("/usuaris"))).toEqual(["/usuaris"]);
    expect(marcat(await barra("/connexions"))).toEqual(["/connexions"]);
    expect(marcat(await barra("/feines"))).toEqual(["/feines"]);
  });

  test("una adreça que no es de cap enllaç no en marca cap", async () => {
    expect(marcat(await barra("/contrasenya"))).toEqual([]);
  });

  test("una pagina qualsevol neix amb la regio viva", async () => {
    expect(await barra("/e/personal")).toContain('<div id="toast" aria-live="polite">');
  });
});

/**
 * El calaix del mobil.
 *
 * Es de CSS pur: una casella amagada i uns `<label>` que hi apunten. Si algu
 * canvia l'identificador d'un costat i no de l'altre, el menu deixa d'obrir-se
 * i res no peta —el navegador no es queixa d'un `for` que no apunta enlloc—,
 * de manera que el que es comprova aqui es que els dos costats es diguin igual.
 */
describe("el calaix de la navegacio", () => {
  test("la casella i tots els `for` que hi apunten es diuen igual", async () => {
    const pagina = await barra("/e/personal");

    expect(pagina).toContain('<input type="checkbox" id="menu-obert"');
    // El d'obrir, el rerefons i el de tancar.
    expect([...pagina.matchAll(/for="menu-obert"/g)]).toHaveLength(3);
  });

  test("els botons del calaix diuen que fan", async () => {
    const pagina = await barra("/e/personal");

    // Son `<label>` amb una icona a dins: sense aixo no diuen res.
    expect(pagina).toContain('aria-label="Obre el menu"');
    expect(pagina).toContain('aria-label="Tanca el menu"');
  });

  test("els comptadors no es dupliquen a la barra de dalt", async () => {
    // Son objectius fora de banda i cada identificador te un sol amo: si es
    // dibuixessin dos cops, l'intercanvi nomes en trobaria un i l'altre
    // quedaria encallat amb el numero vell. Vegeu AGENTS.md.
    const pagina = await barra("/e/personal");

    expect([...pagina.matchAll(/id="comptador-revisio"/g)]).toHaveLength(1);
    expect([...pagina.matchAll(/id="comptador-avisos"/g)]).toHaveLength(1);
  });

  test("la barra de dalt diu a quin espai ets", async () => {
    expect(await barra("/e/personal")).toContain(
      '<span class="barra-mobil-espai text-suau">Personal</span>',
    );
  });
});

describe("#toast", () => {
  test("canvia el contingut i no el contenidor", () => {
    // Si tornes un `<div id="toast">`, te'n vas la regio viva amb ell.
    for (const node of [toast("Ha petat"), clearToast()]) {
      expect(String(node)).toContain('hx-swap-oob="innerHTML:#toast"');
      expect(String(node)).not.toContain('id="toast"');
    }
  });

  test("un error interromp; una confirmacio espera el seu torn", () => {
    expect(String(toast("Ha petat", "error"))).toContain('role="alert"');
    expect(String(toast("Fet", "success"))).toContain('role="status"');
    expect(String(toast("Compte", "info"))).toContain('role="status"');
  });

  test("el missatge s'escapa", () => {
    expect(String(toast("<img src=x onerror=alert(1)>"))).not.toContain("<img");
  });
});
