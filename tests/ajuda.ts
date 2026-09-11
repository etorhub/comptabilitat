/**
 * El que totes les proves necessiten i cadascuna es reescrivia.
 *
 * L'`entra()` d'aqui estava copiat a **set** fitxers de proves, amb els
 * mateixos dos parells de claudators i les mateixes dues expressions regulars
 * —deu copies d'una, sis de l'altra— i petites diferencies de noms de variable
 * que no volien dir res. Quan una cosa es copia set vegades, la vuitena persona
 * que la necessita en fa una altra versio lleugerament diferent.
 *
 * No es un fitxer de proves (`ajuda.ts`, no `ajuda.test.ts`): el `bun test`
 * nomes recull els `*.test.ts`.
 *
 * **Els testimonis es llegeixen del marcatge, no amb una expressio regular.**
 * El CSRF de la sessio viu a l'`hx-headers` del `<body>` i el de l'entrada a un
 * camp ocult; `attributeOf()` els treu d'alli mirant els atributs de debo. Una
 * expressio regular sobre HTML encerta fins al dia que algu mou un atribut o
 * canvia les cometes, i llavors falla d'una manera que no s'enten.
 */

import { attributeOf } from "../htmx-contract/index.ts";
import { app } from "../src/server.ts";

/** La contrasenya que fan servir totes les proves. */
export const CONTRASENYA = "provaprovaprova";

export interface Sessio {
  /** La galeta de sessio, a punt per posar a `Cookie`. */
  cookie: string;
  /** El testimoni per a qualsevol peticio que no sigui `GET`. */
  csrf: string;
}

/** La primera galeta d'un `set-cookie`, sense els seus atributs. */
function galeta(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/**
 * Entra i torna la galeta de sessio i el testimoni CSRF que li correspon.
 *
 * Son dues peticions perque l'aplicacio ho fa en dos temps: el formulari
 * d'entrada encara no te sessio i duu un `_csrf` derivat d'una galeta llavor
 * d'un sol us; el testimoni de debo no existeix fins que la sessio existeix.
 */
export async function entra(email: string, contrasenya = CONTRASENYA): Promise<Sessio> {
  const formulari = await app.request("/entrada");
  const llavor = galeta(formulari);
  const camp =
    (await attributeOf(await formulari.text(), 'input[name="_csrf"]', "value")) ?? "";

  const entrada = await app.request("/entrada", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: llavor },
    body: new URLSearchParams({ _csrf: camp, email, password: contrasenya }).toString(),
  });
  const cookie = galeta(entrada);

  return { cookie, csrf: await csrfDeLaSessio(cookie) };
}

/**
 * El testimoni CSRF que duu qualsevol pagina de la sessio.
 *
 * Surt de l'`hx-headers` del `<body>`, que es on la disposicio el publica un
 * sol cop perque totes les peticions d'HTMX l'heretin.
 */
export async function csrfDeLaSessio(cookie: string): Promise<string> {
  const pagina = await app.request("/contrasenya", { headers: { Cookie: cookie } });
  const capceleres = await attributeOf(await pagina.text(), "body", "hx-headers");
  if (capceleres === null) return "";
  try {
    const llegit: unknown = JSON.parse(capceleres);
    if (typeof llegit !== "object" || llegit === null) return "";
    const valor = (llegit as Record<string, unknown>)["X-CSRF-Token"];
    return typeof valor === "string" ? valor : "";
  } catch {
    return "";
  }
}

/** Una peticio autenticada, amb el testimoni ja posat si cal. */
export async function comA(
  sessio: Sessio,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const metode = (init.method ?? "GET").toUpperCase();
  const capceleres = new Headers(init.headers);
  capceleres.set("Cookie", sessio.cookie);
  if (metode !== "GET" && metode !== "HEAD") capceleres.set("X-CSRF-Token", sessio.csrf);
  return app.request(url, { ...init, headers: capceleres });
}
