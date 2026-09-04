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

/**
 * Demana a la pagina que recarregui del tot. Per als canvis que toquen tantes
 * coses que enumerar-les seria pitjor que tornar-hi (per exemple, moure un
 * compte d'espai).
 */
export function refresh(c: Context) {
  c.header("HX-Refresh", "true");
  return c.body(null, 204);
}

// --- Avisos (`#toast`) -----------------------------------------------------

export type ToastTone = "error" | "success" | "info";

const TONES: Record<ToastTone, { classe: string; etiqueta: string }> = {
  error: { classe: "toast-error", etiqueta: "Error" },
  success: { classe: "toast-success", etiqueta: "Fet" },
  info: { classe: "toast-info", etiqueta: "Avis" },
};

/**
 * El fragment de `#toast`, sempre fora de banda.
 *
 * Es l'unica manera de dir alguna cosa a qui fa servir l'aplicacio quan una
 * peticio falla. Cap ruta no s'inventa el seu propi lloc per als errors.
 *
 * `role="alert"` i `aria-live` fan que un lector de pantalla ho digui sense
 * que calgui moure-hi el focus.
 */
export function toast(missatge: string, tone: ToastTone = "error", detall?: string) {
  const { classe, etiqueta } = TONES[tone];
  return html`<div id="toast" hx-swap-oob="true">
    <div class="toast ${classe}" role="alert" aria-live="assertive">
      <div class="toast-cos">
        <strong>${etiqueta}</strong>
        <span>${missatge}</span>
        ${detall ? html`<small>${detall}</small>` : ""}
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
  return html`<div id="toast" hx-swap-oob="true"></div>`;
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
  missatge: string,
  status = 422,
  tone: ToastTone = "error",
  detall?: string,
) {
  c.header("HX-Reswap", "none");
  c.status(status as Parameters<typeof c.status>[0]);
  return c.html(toast(missatge, tone, detall));
}

/** El mateix, a partir d'un error del domini. */
export function toastError(c: Context, error: unknown) {
  const { status, missatge, detall } = describeError(error);
  return toastOnly(c, missatge, status, "error", detall);
}

export function describeError(error: unknown): {
  status: number;
  missatge: string;
  detall?: string;
} {
  if (error instanceof AppError) {
    return { status: error.status, missatge: error.message, detall: error.detail };
  }
  // Res del que no esperavem no ha de sortir a la pantalla: podria dur-hi
  // dades del banc o de la base de dades.
  console.error("[error]", error);
  return { status: 500, missatge: "Hi ha hagut un error inesperat" };
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
export function jsonScript(id: string, data: unknown) {
  const text = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return html`<script type="application/json" id="${id}">
    ${raw(text)}
  </script>`;
}

/** Llegeix un enter d'un paràmetre de consulta, amb limits. */
export function intParam(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
