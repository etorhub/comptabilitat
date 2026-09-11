/**
 * A model of what htmx does with a response.
 *
 * This is the piece that stands in for a browser, so it is worth being precise
 * about what it is: **a model of htmx 2, not htmx.** It covers the response
 * path — out-of-band extraction, `HX-Reswap`, `HX-Retarget`, and the swap
 * styles — because that is where this project's bugs have actually been. It
 * does not cover CSS, focus, `htmx:*` event handlers, settling, transitions, or
 * anything a stylesheet or a script does after the swap.
 *
 * `MODELLED` below is the list, and it is the thing to re-read when
 * `public/htmx.min.js` is bumped.
 */

import { innerHtmlOf, inspect, outerHtmlOf, withoutOob, type SwapStyle } from "./inspect.ts";

/** What this file claims to reproduce. Anything not on the list, it does not. */
export const MODELLED = [
  "hx-swap-oob extraction before the main swap",
  "hx-swap-oob values: true, a bare swap style, and <style>:<selector>",
  "HX-Reswap overriding hx-swap, including the value none",
  "HX-Retarget overriding hx-target",
  "swap styles: innerHTML, outerHTML, beforebegin, afterbegin, beforeend, afterend, delete, none",
  "the default swap style, innerHTML, when none is given",
  "4xx responses swapping only because the application opts in (see allowErrorSwap)",
] as const;

export interface SwapInput {
  /** The document the interaction started from. */
  page: string;
  /** The body the route answered with. */
  response: string;
  /** Response headers. `HX-Reswap` and `HX-Retarget` are read from here. */
  headers?: Headers | Record<string, string>;
  /** HTTP status, so error responses behave like the application's. */
  status?: number;
  /** The selector the trigger aimed at. */
  target?: string | null;
  /** The trigger's `hx-swap`. Defaults to htmx's own default, `innerHTML`. */
  swap?: string;
  /**
   * Whether a 4xx response is swapped at all.
   *
   * htmx does not swap error responses by default. This application opts back
   * in with an `htmx:beforeSwap` handler in the layout, because its errors
   * arrive as an out-of-band toast inside a 4xx. Default true to match; set
   * false to model stock htmx.
   */
  allowErrorSwap?: boolean;
}

export interface SwapResult {
  /** The page as it would look after the interaction. */
  html: string;
  /** The swap style actually used, after `HX-Reswap`. */
  swap: string;
  /** The target actually used, after `HX-Retarget`. */
  target: string | null;
  /** Whether a main swap happened at all. */
  swapped: boolean;
  /** The response body with its out-of-band nodes removed. */
  remainder: string;
}

function header(headers: SwapInput["headers"], name: string): string | null {
  if (headers === undefined) return null;
  if (headers instanceof Headers) return headers.get(name);
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

export function reswapOf(input: SwapInput): string | null {
  return header(input.headers, "HX-Reswap");
}

/** Apply one piece of content to one target, the way a swap style says to. */
async function applyTo(
  document: string,
  selector: string,
  content: string,
  style: SwapStyle,
): Promise<string> {
  if (style === "none") return document;
  return new HTMLRewriter()
    .on(selector, {
      element(el) {
        switch (style) {
          case "outerHTML":
            el.replace(content, { html: true });
            break;
          case "innerHTML":
            el.setInnerContent(content, { html: true });
            break;
          case "textContent":
            el.setInnerContent(content, { html: false });
            break;
          case "beforebegin":
            el.before(content, { html: true });
            break;
          case "afterbegin":
            el.prepend(content, { html: true });
            break;
          case "beforeend":
            el.append(content, { html: true });
            break;
          case "afterend":
            el.after(content, { html: true });
            break;
          case "delete":
            el.remove();
            break;
        }
      },
    })
    .transform(new Response(document))
    .text();
}

/**
 * Replay a response against the page that triggered it.
 *
 * Order matters and matches htmx: the out-of-band nodes come out of the
 * response first and are swapped by id, and only what is left goes to the
 * target. That order is exactly why an all-out-of-band body deletes its target
 * — the leftover is nothing, and nothing is what gets swapped in.
 */
export async function applySwap(input: SwapInput): Promise<SwapResult> {
  const { page, response, status = 200 } = input;
  const allowErrorSwap = input.allowErrorSwap ?? true;

  const reswap = reswapOf(input);
  const retarget = header(input.headers, "HX-Retarget");
  const target = retarget ?? input.target ?? null;
  const swap = (reswap ?? input.swap ?? "innerHTML").trim();

  const errored = status >= 400 && status < 500;
  if (errored && !allowErrorSwap) {
    return { html: page, swap, target, swapped: false, remainder: response };
  }

  // Out-of-band first, by id, regardless of the main swap.
  let html = page;
  const snapshot = await inspect(response);

  for (const [index, node] of snapshot.oob.entries()) {
    if (node.target === null) continue;
    const content =
      node.mode === "outerHTML"
        ? await outerHtmlOf(response, "[hx-swap-oob]", index)
        : await innerHtmlOf(response, "[hx-swap-oob]", index);
    if (content === null) continue;
    html = await applyTo(html, node.target, content, node.mode);
  }

  const remainder = (await withoutOob(response)).trim();

  if (swap === "none" || target === null) {
    return { html, swap, target, swapped: false, remainder };
  }

  html = await applyTo(html, target, remainder, swap as SwapStyle);
  return { html, swap, target, swapped: true, remainder };
}
