/**
 * Reading a rendered document.
 *
 * Everything this library knows about a document comes from here. It is built
 * on Bun's `HTMLRewriter`, which has two properties the rules depend on:
 * it streams (so ancestry has to be tracked by hand, see `onEndTag` below) and
 * it passes unmodified bytes through untouched, so anything extracted with the
 * sentinel trick in `outerHtmlOf` is the original markup, not a re-serialised
 * approximation.
 *
 * No dependencies, and nothing here knows anything about the application.
 */

/** Swap styles htmx understands. Anything else is a typo, and a typo is silent. */
export const SWAP_STYLES = [
  "innerHTML",
  "outerHTML",
  "textContent",
  "beforebegin",
  "afterbegin",
  "beforeend",
  "afterend",
  "delete",
  "none",
] as const;

export type SwapStyle = (typeof SWAP_STYLES)[number];

export function isSwapStyle(value: string): value is SwapStyle {
  return (SWAP_STYLES as readonly string[]).includes(value);
}

/** An element carrying `hx-swap-oob`, and where its content is headed. */
export interface OobNode {
  /** The selector it lands on, e.g. `#toast`. Null when it cannot resolve one. */
  target: string | null;
  mode: SwapStyle;
  /** The raw attribute value, for error messages. */
  raw: string;
  /** The node's own `id`, which is the target when the value names no selector. */
  ownId: string | null;
  tag: string;
}

/** An element carrying at least one `hx-*` attribute. */
export interface HxElement {
  tag: string;
  id: string | null;
  /** Only the `hx-*` attributes, by name. */
  attrs: Record<string, string>;
}

/** A control that contributes a value to a request. */
export interface FormField {
  name: string;
  /**
   * Which `<form>` encloses it, or null when it stands alone.
   *
   * Forms are numbered in document order. Two fields sharing a name only
   * collide when they share a form: that is the whole point of the index.
   */
  formIndex: number | null;
  tag: string;
}

/** An `hx-trigger="every …"` that will keep firing until something stops it. */
export interface Poll {
  everyMs: number;
  /** Whether the element declares a bound, via `data-poll-max`. */
  bounded: boolean;
  raw: string;
  id: string | null;
}

export interface Snapshot {
  html: string;
  /** Every `id` in the document, mapped to how many times it occurs. */
  ids: Map<string, number>;
  elements: HxElement[];
  oob: OobNode[];
  fields: FormField[];
  polls: Poll[];
  /** True when this looks like a whole page rather than a fragment. */
  standalone: boolean;
}

/**
 * The attribute an element uses to declare that its polling is bounded.
 *
 * The library does not care how the bound is enforced — only that the author
 * said there is one. Enforcement is the server's job, because the counter has
 * to survive a page the client never keeps state for.
 */
export const BOUNDED_POLL_ATTR = "data-poll-max";

const FIELD_SELECTOR = "input,select,textarea";

function parseEvery(trigger: string): number | null {
  const match = /every\s+([\d.]+)\s*(ms|s|m)\b/i.exec(trigger);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "m") return amount * 60_000;
  return amount * 1000;
}

/**
 * Where an `hx-swap-oob` value sends its element.
 *
 * htmx accepts three shapes: `true` (meaning `outerHTML` onto the node's own
 * id), a bare swap style (same target, different style), and
 * `<style>:<selector>` (an explicit target). A node whose value names no
 * selector *and* carries no id has nowhere to land; `target` is null and
 * `dead-oob` reports it.
 */
function parseOob(
  raw: string,
  ownId: string | null,
): { target: string | null; mode: SwapStyle } {
  const value = raw.trim();
  const own = ownId ? `#${ownId}` : null;

  if (value === "" || value === "true") return { target: own, mode: "outerHTML" };

  const colon = value.indexOf(":");
  if (colon === -1) {
    return { target: own, mode: isSwapStyle(value) ? value : "outerHTML" };
  }

  const style = value.slice(0, colon).trim();
  const selector = value.slice(colon + 1).trim();
  return {
    target: selector === "" ? own : selector,
    mode: isSwapStyle(style) ? style : "outerHTML",
  };
}

/** Read a document. */
export async function inspect(html: string): Promise<Snapshot> {
  const ids = new Map<string, number>();
  const elements: HxElement[] = [];
  const oob: OobNode[] = [];
  const fields: FormField[] = [];
  const polls: Poll[] = [];

  // Streaming means ancestry is ours to track: a stack of open <form> indices,
  // pushed on the start tag and popped by the matching end tag.
  const openForms: number[] = [];
  let formsSeen = 0;

  await new HTMLRewriter()
    .on("form", {
      element(el) {
        const index = formsSeen++;
        // A self-closing <form/> never gets an end tag; nothing may nest in it.
        if (el.selfClosing) return;
        openForms.push(index);
        el.onEndTag(() => {
          openForms.pop();
        });
      },
    })
    .on(FIELD_SELECTOR, {
      element(el) {
        const name = el.getAttribute("name");
        if (name === null || name === "") return;
        fields.push({
          name,
          formIndex: openForms.at(-1) ?? null,
          tag: el.tagName.toLowerCase(),
        });
      },
    })
    .on("*", {
      element(el) {
        const id = el.getAttribute("id");
        if (id !== null && id !== "") ids.set(id, (ids.get(id) ?? 0) + 1);

        const attrs: Record<string, string> = {};
        for (const [name, value] of el.attributes) {
          if (name.startsWith("hx-")) attrs[name] = value;
        }

        const tag = el.tagName.toLowerCase();

        if (Object.keys(attrs).length > 0) elements.push({ tag, id, attrs });

        const rawOob = attrs["hx-swap-oob"];
        if (rawOob !== undefined) {
          oob.push({ ...parseOob(rawOob, id), raw: rawOob, ownId: id, tag });
        }

        const trigger = attrs["hx-trigger"];
        if (trigger !== undefined) {
          const everyMs = parseEvery(trigger);
          if (everyMs !== null) {
            polls.push({
              everyMs,
              bounded: el.getAttribute(BOUNDED_POLL_ATTR) !== null,
              raw: trigger,
              id,
            });
          }
        }
      },
    })
    .transform(new Response(html))
    .text();

  return {
    html,
    ids,
    elements,
    oob,
    fields,
    polls,
    standalone: /<html[\s>]|<!doctype/i.test(html),
  };
}

const SENTINEL_START = "@@htmx-contract-start@@";
const SENTINEL_END = "@@htmx-contract-end@@";

/**
 * The exact markup of the n-th element matching `selector`, outer or inner.
 *
 * Done by fencing the element with sentinels and slicing between them, so what
 * comes back is the document's own bytes — attribute order, quoting and entity
 * spelling included. Rebuilding the markup from `HTMLRewriter`'s events would
 * lose all three, and a checker that silently reformats what it inspects is
 * hard to trust when it reports a difference.
 */
async function fenced(
  html: string,
  selector: string,
  index: number,
  where: "outer" | "inner",
): Promise<string | null> {
  let seen = 0;
  const out = await new HTMLRewriter()
    .on(selector, {
      element(el) {
        if (seen++ !== index) return;
        if (where === "inner") {
          el.prepend(SENTINEL_START, { html: true });
          el.append(SENTINEL_END, { html: true });
          return;
        }
        el.before(SENTINEL_START, { html: true });
        el.onEndTag((end) => {
          end.after(SENTINEL_END, { html: true });
        });
      },
    })
    .transform(new Response(html))
    .text();

  const from = out.indexOf(SENTINEL_START);
  const to = out.indexOf(SENTINEL_END);
  if (from === -1 || to === -1 || to < from) return null;
  return out.slice(from + SENTINEL_START.length, to);
}

export function outerHtmlOf(html: string, selector: string, index = 0): Promise<string | null> {
  return fenced(html, selector, index, "outer");
}

export function innerHtmlOf(html: string, selector: string, index = 0): Promise<string | null> {
  return fenced(html, selector, index, "inner");
}

/** The document with every `hx-swap-oob` element taken out, as htmx would. */
export async function withoutOob(html: string): Promise<string> {
  return new HTMLRewriter()
    .on("[hx-swap-oob]", {
      element(el) {
        el.remove();
      },
    })
    .transform(new Response(html))
    .text();
}

/**
 * The tag name and id of the first element in a fragment, if it has one.
 *
 * `HTMLRewriter` reports elements in document order, so the first one it hands
 * us is the fragment's root. No depth tracking: counting would mean handling
 * void elements, whose end tags never arrive, and there is nothing to count.
 */
export async function rootElement(
  html: string,
): Promise<{ tag: string; id: string | null } | null> {
  let root: { tag: string; id: string | null } | null = null;
  await new HTMLRewriter()
    .on("*", {
      element(el) {
        if (root !== null) return;
        root = { tag: el.tagName.toLowerCase(), id: el.getAttribute("id") };
      },
    })
    .transform(new Response(html))
    .text();
  return root;
}
