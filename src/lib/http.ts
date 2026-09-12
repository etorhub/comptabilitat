/**
 * Convencions de resposta.
 *
 * Aquestes funcions son l'unica manera de contestar. Si un recurs necessita
 * fer-ho d'una altra manera, primer canvia aixo i despres tots els recursos:
 * val mes ser consistents que ser llestos en un lloc.
 *
 * Regles (vegeu `AGENTS.md`):
 *
 *   - `GET <base>` retorna **sempre** una pagina sencera.
 *   - `GET <base>/fragment/<nom>` retorna **sempre** un fragment.
 *   - `POST|PATCH|DELETE` retornen el tros que ha canviat, mes els
 *     intercanvis fora de banda que calguin.
 *   - No es mira mai la capçalera `HX-Request` per decidir que es retorna.
 */

import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

import type { Html } from "./html.ts";
import { oobWrapper } from "./oob.ts";

/** Error del domini que sap amb quin codi HTTP s'ha de contestar. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** 404 tant si no existeix com si no hi tens acces: vegeu `middleware/workspace`. */
export class NotFoundError extends AppError {
  constructor(message = "No s'ha trobat") {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tens permis per fer aixo") {
    super(message, 403);
  }
}

/** 409: el servidor sap que falta, i el fragment de resposta ho ha de dir. */
export class ConflictError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 409, detail);
  }
}

// --- Renderitzat -----------------------------------------------------------

/**
 * Una pagina sencera. Nomes des d'un `GET` a l'adreça canonica del recurs.
 */
export function page(c: Context, node: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return c.html(node);
}

/**
 * Un fragment. `status` per als errors de validacio (422) i els conflictes
 * (409), que tambe tornen marcatge.
 */
export function fragment(
  c: Context,
  node: HtmlEscapedString | Promise<HtmlEscapedString>,
  status = 200,
) {
  c.status(status as Parameters<typeof c.status>[0]);
  return c.html(node);
}

/**
 * Diu al navegador quina adreça ha de quedar a la barra i a l'historial.
 *
 * Es aixi com els filtres i la paginacio continuen sent enllaçables i com el
 * boto d'enrere continua funcionant, tot i que qui contesta es una ruta de
 * fragment. Passa-hi sempre l'adreça **de la pagina**, no la del fragment.
 */
export function pushUrl(c: Context, url: string): void {
  c.header("HX-Push-Url", url);
}

/**
 * Redireccio que funciona tant si la peticio ve d'HTMX com si no.
 *
 * Sense `HX-Redirect`, un `hx-post` que contestes un 302 acabaria enganxant
 * la pagina de desti dins d'un `<div>`.
 */
export function redirect(c: Context, url: string) {
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", url);
    return c.body(null, 204);
  }
  return c.redirect(url, 303);
}

// --- Avisos (`#toast`) -----------------------------------------------------

export type ToastTone = "error" | "success" | "info";

const TONES: Record<ToastTone, { cssClass: string; tag: string }> = {
  error: { cssClass: "toast-error", tag: "Error" },
  success: { cssClass: "toast-success", tag: "Fet" },
  info: { cssClass: "toast-info", tag: "Avis" },
};

/**
 * El fragment de `#toast`, sempre fora de banda.
 *
 * Es l'unica manera de dir alguna cosa a qui fa servir l'aplicacio quan una
 * peticio falla. Cap ruta no s'inventa el seu propi lloc per als errors.
 *
 * **Es canvia el contingut del `#toast`, no el `#toast`.** Una regio viva
 * l'ha d'anunciar el navegador quan hi entra text, i per aixo ha d'existir
 * *abans*: si es substitueix el node sencer, el que arriba es un node nou
 * que encara no era cap regio viva quan es va omplir. Amb
 * `hx-swap-oob="true"` era exactament aixo el que passava —i, a mes, el
 * `#toast` de recanvi no duia `aria-live`, de manera que a partir del primer
 * avis la regio ja no hi era per a ningu. El `innerHTML:#toast` deixa el
 * contenidor de `components/layout.tsx` quiet per sempre.
 *
 * El to tria el paper: un error interromp el que s'estigui llegint
 * (`role="alert"`), i una confirmacio espera el seu torn (`role="status"`).
 */
export function toast(message: string, tone: ToastTone = "error", detail?: string) {
  const { cssClass, tag } = TONES[tone];
  return html`<div ${oobWrapper("toast")}>
    <div class="toast ${cssClass}" role="${tone === "error" ? "alert" : "status"}">
      <div class="toast-cos">
        <strong>${tag}</strong>
        <span>${message}</span>
        ${detail ? html`<small>${detail}</small>` : ""}
      </div>
      <button
        type="button"
        class="toast-tanca"
        aria-label="Tanca l'avis"
        onclick="this.closest('#toast').replaceChildren()"
      >
        &times;
      </button>
    </div>
  </div>`;
}

/** El `#toast` buit que va a totes les respostes correctes, per netejar l'anterior. */
export function clearToast() {
  return html`<div ${oobWrapper("toast")}></div>`;
}

/**
 * Resposta que nomes duu el `#toast`, amb el codi que toqui.
 *
 * **La capçalera `HX-Reswap: none` no es opcional.** Un cos que nomes conte
 * intercanvis fora de banda es queda buit quan HTMX els treu d'alli, i llavors
 * HTMX intercanvia aquest buit dins de l'`hx-target`. Amb
 * `hx-swap="outerHTML"` —que es el que fan servir totes les files i totes les
 * targetes de l'aplicacio— aixo **esborra de la pagina l'element que l'usuari
 * estava tocant**. Amb `HX-Reswap: none` no hi ha intercanvi principal, i els
 * fora de banda s'apliquen igualment.
 *
 * Recorda que el `htmx:beforeSwap` de `components/layout.tsx` deixa passar els
 * 4xx a proposit; sense aixo el `#toast` no arribaria mai.
 */
export function toastOnly(
  c: Context,
  message: string,
  status = 422,
  tone: ToastTone = "error",
  detail?: string,
) {
  c.header("HX-Reswap", "none");
  c.status(status as Parameters<typeof c.status>[0]);
  return c.html(toast(message, tone, detail));
}

export function describeError(error: unknown): {
  status: number;
  message: string;
  detail?: string;
} {
  if (error instanceof AppError) {
    return { status: error.status, message: error.message, detail: error.detail };
  }
  // Res del que no esperavem no ha de sortir a la pantalla: podria dur-hi
  // dades del banc o de la base de dades.
  console.error("[error]", error);
  return { status: 500, message: "Hi ha hagut un error inesperat" };
}

/**
 * Ajunta el tros principal amb els intercanvis fora de banda que l'acompanyen.
 *
 * Es la manera normal de contestar una mutacio:
 *
 *     return fragment(c, await withOob(
 *       TargetaAvis({ ... }),                    // el que ha canviat
 *       ComptadorAvisos(n, true),                // el comptador de la barra
 *       clearToast(),                            // esborra l'error anterior
 *     ));
 *
 * L'ordre no importa: HTMX treu els nodes amb `hx-swap-oob` d'on siguin i els
 * porta al seu objectiu; la resta va a `hx-target`.
 */
export async function withOob(...nodes: (Html | string)[]): Promise<HtmlEscapedString> {
  const parts = await Promise.all(nodes);
  return raw(parts.join("")) as HtmlEscapedString;
}

// --- Utilitats -------------------------------------------------------------

/** Serialitza dades per a una illa de JavaScript (un grafic), sense escapar-ne el HTML. */
export function jsonScript(id: string, date: unknown) {
  const text = JSON.stringify(date)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return html`<script type="application/json" id="${id}">
    ${raw(text)}
  </script>`;
}

/**
 * L'identificador que ve de l'adreça.
 *
 * Nomes digits: un `Number.parseInt("12abc")` retorna 12, i aixi
 * `/moviments/12qualsevolcosa` era una adreça valida.
 *
 * El missatge el posa cada recurs, pero **el codi es sempre 404**: qui
 * demana un identificador que no es un numero no ha de saber si existeix.
 */
export function idFromRoute(valor: string | undefined, queNoExisteix: string): number {
  if (valor === undefined || !/^\d+$/.test(valor)) throw new NotFoundError(queNoExisteix);
  const id = Number.parseInt(valor, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError(queNoExisteix);
  return id;
}
