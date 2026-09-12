/**
 * Response conventions.
 *
 * These functions are the only way to answer a request. If a resource needs
 * something else, change this first and then every resource: being consistent
 * beats being clever in one place.
 *
 * The rules (see `AGENTS.md`):
 *
 *   - `GET <base>` **always** returns a whole page.
 *   - `GET <base>/fragment/<name>` **always** returns a fragment.
 *   - `POST|PATCH|DELETE` return the piece that changed, plus whatever
 *     out-of-band swaps go with it.
 *   - The `HX-Request` header is never read to decide *what* to return.
 *
 * Text that reaches a screen stays in Catalan: this is a Catalan application,
 * and only the code around it is English.
 */

import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

import type { Html } from "./html.ts";
import { oobWrapper } from "./oob.ts";

/** A domain error that knows which HTTP status it should answer with. */
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

/** 404 both when it does not exist and when you have no access: see `middleware/workspace`. */
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

/** 409: the server knows what is missing, and the response fragment must say so. */
export class ConflictError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 409, detail);
  }
}

// --- Rendering -------------------------------------------------------------

/** A whole page. Only from a `GET` to the resource's canonical URL. */
export function page(c: Context, node: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return c.html(node);
}

/**
 * A fragment. `status` is for validation errors (422) and conflicts (409),
 * which also answer with markup.
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
 * Tells the browser which URL should end up in the address bar and history.
 *
 * This is how filters and pagination stay linkable and how the back button
 * keeps working even though a fragment route is what answered. Always pass the
 * **page's** URL, never the fragment's.
 */
export function pushUrl(c: Context, url: string): void {
  c.header("HX-Push-Url", url);
}

/**
 * A redirect that works whether or not the request came from htmx.
 *
 * Without `HX-Redirect`, an `hx-post` answered with a 302 would end up pasting
 * the destination page inside a `<div>`.
 */
export function redirect(c: Context, url: string) {
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", url);
    return c.body(null, 204);
  }
  return c.redirect(url, 303);
}

// --- Notices (`#toast`) ----------------------------------------------------

export type ToastTone = "error" | "success" | "info";

const TONES: Record<ToastTone, { cssClass: string; tag: string }> = {
  error: { cssClass: "toast-error", tag: "Error" },
  success: { cssClass: "toast-success", tag: "Fet" },
  info: { cssClass: "toast-info", tag: "Avis" },
};

/**
 * The `#toast` fragment, always out of band.
 *
 * It is the only way to tell the person using the application that a request
 * failed. No route invents its own place for errors.
 *
 * **The `#toast`'s *content* is replaced, not the `#toast` itself.** A live
 * region has to be announced by the browser when text arrives in it, which
 * means it must already exist: replacing the whole node gives you a new node
 * that was not a live region when it was filled. With `hx-swap-oob="true"`
 * that is exactly what happened — and the replacement `#toast` carried no
 * `aria-live`, so from the first notice onwards the region was gone for
 * everyone. `innerHTML:#toast` leaves the container in `components/layout.ts`
 * alone for good.
 *
 * The tone picks the ARIA role: an error interrupts whatever is being read
 * (`role="alert"`), a confirmation waits its turn (`role="status"`).
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

/** The empty `#toast` that rides along with every successful response, clearing the last one. */
export function clearToast() {
  return html`<div ${oobWrapper("toast")}></div>`;
}

/**
 * A response carrying nothing but the `#toast`, with the right status.
 *
 * **The `HX-Reswap: none` header is not optional.** A body that contains only
 * out-of-band swaps is left empty once htmx lifts them out, and htmx then
 * swaps that emptiness into `hx-target`. With `hx-swap="outerHTML"` — which is
 * what every row and every card in this application uses — that **deletes the
 * element the user was touching**. With `HX-Reswap: none` there is no main
 * swap, and the out-of-band ones still apply.
 *
 * Remember that the `htmx:beforeSwap` handler in `components/layout.ts` lets
 * 4xx responses through on purpose; without it the `#toast` would never arrive.
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
  // Nothing unexpected reaches the screen: it could carry data from the bank
  // or from the database.
  console.error("[error]", error);
  return { status: 500, message: "Hi ha hagut un error inesperat" };
}

/**
 * Joins the main piece with the out-of-band swaps that accompany it.
 *
 * This is the normal way to answer a mutation:
 *
 *     return fragment(c, await withOob(
 *       AlertCard({ ... }),      // what changed
 *       AlertCounter(n, true),   // the sidebar counter
 *       clearToast(),            // clears the previous error
 *     ));
 *
 * Order does not matter: htmx lifts the `hx-swap-oob` nodes out from wherever
 * they are and sends them to their target; the rest goes to `hx-target`.
 */
export async function withOob(...nodes: (Html | string)[]): Promise<HtmlEscapedString> {
  const parts = await Promise.all(nodes);
  return raw(parts.join("")) as HtmlEscapedString;
}

// --- Utilities -------------------------------------------------------------

/** Serialises data for a JavaScript island (a chart), without HTML-escaping it. */
export function jsonScript(id: string, data: unknown) {
  const text = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return html`<script type="application/json" id="${id}">
    ${raw(text)}
  </script>`;
}

/**
 * The id that comes from the URL.
 *
 * Digits only: `Number.parseInt("12abc")` returns 12, which made
 * `/moviments/12anythingatall` a valid address.
 *
 * Each resource supplies the message, but **the status is always 404**: asking
 * for an id that is not a number should not tell you whether it exists.
 */
export function idFromRoute(value: string | undefined, notFoundMessage: string): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new NotFoundError(notFoundMessage);
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError(notFoundMessage);
  return id;
}
