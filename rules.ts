/**
 * The rules.
 *
 * Every rule here exists because the bug it catches actually shipped. The
 * `origin` field on each one names the commit, and `fixtures/` holds the
 * pre-fix markup so the rule is tested against the thing it claims to catch.
 * A rule that cannot fail against its own bug is decoration.
 *
 * What they have in common: none of them are visible to a type checker, a
 * linter, or a test that asserts on a response body. They live in the seam
 * between the HTML a route returns and the DOM that receives it, and that seam
 * is a string on one side and a browser on the other.
 */

import { BOUNDED_POLL_ATTR, rootElement, withoutOob, type Snapshot } from "./inspect.ts";

export type RuleName =
  | "duplicate-id"
  | "duplicate-field-in-form"
  | "empty-after-oob"
  | "dead-target"
  | "dead-oob"
  | "target-identity-lost"
  | "unbounded-poll";

export interface Violation {
  rule: RuleName;
  message: string;
  detail?: string;
}

/**
 * Target selectors that say "somewhere relative to me" rather than naming an id.
 *
 * These cannot be resolved without a DOM, so `dead-target` leaves them alone
 * instead of guessing. Anything else that is not a plain `#id` is skipped too.
 */
const RELATIVE_TARGETS = /^(this|closest |find |next|previous|body$|document$)/;

function plainId(selector: string): string | null {
  const value = selector.trim();
  if (!value.startsWith("#")) return null;
  const id = value.slice(1);
  // `#a .b` or `#a > b` is a descendant selector, not an id we can check.
  return /^[\w:.-]+$/.test(id) ? id : null;
}

/** Same id twice in one document. */
export function duplicateId(snapshot: Snapshot): Violation[] {
  const out: Violation[] = [];
  for (const [id, count] of snapshot.ids) {
    if (count < 2) continue;
    out.push({
      rule: "duplicate-id",
      message: `id "${id}" appears ${count} times in one document`,
      detail:
        "Invalid HTML, and htmx swaps the first match, so the wrong element is " +
        "replaced. aria-describedby and label/for point at the first one too.",
    });
  }
  return out;
}

/**
 * Two controls sharing a name inside one `<form>`.
 *
 * For any non-GET request htmx collects the values of the form enclosing the
 * element (`getInputValues`), and those values *override* the element's own
 * (`overrideFormData`). So a row-level `<select name="category_id">` sitting
 * inside a table-wide form does not send its own value: it sends the last
 * row's.
 */
export function duplicateFieldInForm(snapshot: Snapshot): Violation[] {
  const byForm = new Map<number, Map<string, number>>();
  for (const field of snapshot.fields) {
    if (field.formIndex === null) continue;
    const names = byForm.get(field.formIndex) ?? new Map<string, number>();
    names.set(field.name, (names.get(field.name) ?? 0) + 1);
    byForm.set(field.formIndex, names);
  }

  const out: Violation[] = [];
  for (const [formIndex, names] of byForm) {
    for (const [name, count] of names) {
      if (count < 2) continue;
      out.push({
        rule: "duplicate-field-in-form",
        message: `form #${formIndex} carries ${count} controls named "${name}"`,
        detail:
          "htmx sends every one of them and lets the form's values override the " +
          "element's own, so the element you touched is not the one that is saved. " +
          "Use hx-include to say exactly what goes, instead of an enclosing form.",
      });
    }
  }
  return out;
}

/** `hx-target="#x"` where `#x` is nowhere to be found. */
export function deadTarget(snapshot: Snapshot, knownIds: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  for (const element of snapshot.elements) {
    const target = element.attrs["hx-target"];
    if (target === undefined) continue;
    if (RELATIVE_TARGETS.test(target.trim())) continue;
    const id = plainId(target);
    if (id === null || knownIds.has(id)) continue;
    out.push({
      rule: "dead-target",
      message: `<${element.tag}> targets "${target}", which is not in the document`,
      detail:
        "htmx finds no target and falls back to the triggering element, so the " +
        "response lands somewhere nobody intended — usually swallowing the control " +
        "that was clicked.",
    });
  }
  return out;
}

/** An out-of-band node that can never find its target. */
export function deadOob(snapshot: Snapshot, knownIds: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  for (const node of snapshot.oob) {
    if (node.target === null) {
      out.push({
        rule: "dead-oob",
        message: `<${node.tag} hx-swap-oob="${node.raw}"> names no target and has no id`,
        detail: "htmx drops it silently: the update simply never happens.",
      });
      continue;
    }
    const id = plainId(node.target);
    if (id === null || knownIds.has(id)) continue;
    out.push({
      rule: "dead-oob",
      message: `out-of-band swap targets "${node.target}", which is not in the page`,
      detail: "htmx drops it silently: the update simply never happens.",
    });
  }
  return out;
}

/** `hx-trigger="every …"` with nothing to stop it. */
export function unboundedPoll(snapshot: Snapshot): Violation[] {
  const out: Violation[] = [];
  for (const poll of snapshot.polls) {
    if (poll.bounded) continue;
    out.push({
      rule: "unbounded-poll",
      message: `polls every ${poll.everyMs}ms with no declared bound`,
      detail:
        `Add ${BOUNDED_POLL_ATTR}. A poll that only stops when the server reports a ` +
        "terminal state never stops if the work dies without reaching one — and it " +
        "keeps going for every viewer of the page, not just the one who started it.",
    });
  }
  return out;
}

/**
 * A response whose body is empty once the out-of-band nodes are taken out.
 *
 * htmx lifts `hx-swap-oob` nodes out of the response and swaps them by id. What
 * is left is what goes into `hx-target` — and if that is nothing, it swaps
 * nothing into the target. With `outerHTML`, "nothing" *deletes the target*.
 *
 * So a 422 that answers with only a toast removes the row the user was editing.
 * The cure is `HX-Reswap: none`, which suppresses the main swap and leaves the
 * out-of-band ones alone.
 */
export async function emptyAfterOob(
  responseHtml: string,
  reswap: string | null,
): Promise<Violation[]> {
  if (reswap !== null && reswap.trim() === "none") return [];
  const remainder = (await withoutOob(responseHtml)).trim();
  if (remainder !== "") return [];
  return [
    {
      rule: "empty-after-oob",
      message: "response is empty once its out-of-band nodes are removed",
      detail:
        'htmx will swap that emptiness into hx-target. With hx-swap="outerHTML" ' +
        "the target is deleted from the page. Answer with HX-Reswap: none.",
    },
  ];
}

/**
 * An `outerHTML` swap that returns markup without the target's id.
 *
 * The swap works once and then the element is unaddressable: the next click
 * targets an id that is no longer in the document. It reads as "the button
 * worked the first time and then stopped".
 */
export async function targetIdentityLost(
  responseHtml: string,
  target: string | null,
  swap: string,
): Promise<Violation[]> {
  if (swap !== "outerHTML" || target === null) return [];
  const id = plainId(target);
  if (id === null) return [];

  const remainder = (await withoutOob(responseHtml)).trim();
  // An empty body is `empty-after-oob`'s to report, not this rule's.
  if (remainder === "") return [];

  const root = await rootElement(remainder);
  if (root === null || root.id === id) return [];
  return [
    {
      rule: "target-identity-lost",
      message: `outerHTML swap into "${target}" returns <${root.tag}${
        root.id === null ? "" : ` id="${root.id}"`
      }>`,
      detail:
        `The replacement does not carry id="${id}", so after this swap nothing in ` +
        "the page targets it any more and the next interaction goes nowhere.",
    },
  ];
}
