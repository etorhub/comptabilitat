/**
 * htmx-contract — checking the seam between the HTML a route returns and the
 * DOM that receives it.
 *
 * The problem it exists for: in an htmx application that seam is a string on
 * one side and a browser on the other, so nothing checks it.
 * `hx-target="#row-7"` is just text; a type checker cannot tell you the target
 * is gone, a linter cannot tell you the response body empties itself once the
 * out-of-band nodes are lifted out, and a test that asserts on a response body
 * cannot tell you the swap deletes the element the user was touching. Each of
 * those shipped at least once in this repository, and each was found by a human
 * in a browser, counting rows.
 *
 * The library answers two questions:
 *
 *   checkDocument()  is this rendered page self-consistent?
 *   checkResponse()  would this response, swapped into that page, do damage?
 *
 * and offers `applySwap()` when a test would rather assert on the page *after*
 * the interaction than on the response body.
 *
 * Scope, stated plainly: `swap.ts` models htmx's response handling, not htmx.
 * See `MODELLED` there for the list, and the README for what is left uncovered.
 */

export {
  attributeOf,
  BOUNDED_POLL_ATTR,
  innerHtmlOf,
  inspect,
  isSwapStyle,
  outerHtmlOf,
  rootElement,
  SWAP_STYLES,
  withoutOob,
  type FormField,
  type HxElement,
  type OobNode,
  type Poll,
  type Snapshot,
  type SwapStyle,
} from "./inspect.ts";

export { applySwap, MODELLED, type SwapInput, type SwapResult } from "./swap.ts";

export type { RuleName, Violation } from "./rules.ts";

import { inspect, type Snapshot } from "./inspect.ts";
import {
  deadOob,
  deadTarget,
  duplicateFieldInForm,
  duplicateId,
  emptyAfterOob,
  targetIdentityLost,
  unboundedPoll,
  type Violation,
} from "./rules.ts";
import { applySwap, reswapOf, type SwapInput, type SwapResult } from "./swap.ts";

export interface DocumentOptions {
  /**
   * Treat this as a fragment rather than a whole page.
   *
   * A fragment legitimately points at ids that live in the page around it, so
   * `dead-target` is only meaningful once that page is known. Auto-detected
   * from the markup when not given.
   */
  fragment?: boolean;
  /** Ids that exist even though they are not in this document. */
  knownIds?: Iterable<string>;
}

function idsOf(snapshot: Snapshot, extra?: Iterable<string>): Set<string> {
  const ids = new Set(snapshot.ids.keys());
  for (const id of extra ?? []) ids.add(id);
  return ids;
}

/**
 * Check one rendered document on its own.
 *
 * Use it on every page the application can serve. The rules that need no
 * context — duplicate ids, colliding form fields, unbounded polling — always
 * run; `dead-target` runs only when the document is a whole page, because a
 * fragment's targets belong to the page it lands in.
 */
export async function checkDocument(
  html: string,
  options: DocumentOptions = {},
): Promise<Violation[]> {
  const snapshot = await inspect(html);
  const isFragment = options.fragment ?? !snapshot.standalone;

  const violations = [
    ...duplicateId(snapshot),
    ...duplicateFieldInForm(snapshot),
    ...unboundedPoll(snapshot),
  ];

  if (!isFragment) {
    const ids = idsOf(snapshot, options.knownIds);
    violations.push(...deadTarget(snapshot, ids), ...deadOob(snapshot, ids));
  }

  return violations;
}

export interface ResponseOptions extends SwapInput {
  /** Ids that exist even though they are in neither document. */
  knownIds?: Iterable<string>;
}

/**
 * Check a response against the page that triggered it.
 *
 * This is where the interesting rules live, because they are all about the
 * relationship between the two documents: does the response empty itself, do
 * its out-of-band nodes have anywhere to land, does an `outerHTML` swap hand
 * back something that still answers to the target's id.
 */
export async function checkResponse(options: ResponseOptions): Promise<Violation[]> {
  const { page, response, target = null } = options;
  const pageSnapshot = await inspect(page);
  const responseSnapshot = await inspect(response);

  const reswap = reswapOf(options);
  const swap = (reswap ?? options.swap ?? "innerHTML").trim();

  const known = idsOf(pageSnapshot, options.knownIds);
  // Ids the response introduces count as present: an out-of-band node may
  // legitimately target something the same response is adding.
  for (const id of responseSnapshot.ids.keys()) known.add(id);

  return [
    ...duplicateId(responseSnapshot),
    ...duplicateFieldInForm(responseSnapshot),
    ...unboundedPoll(responseSnapshot),
    ...deadOob(responseSnapshot, known),
    ...(await emptyAfterOob(response, reswap)),
    ...(await targetIdentityLost(response, target, swap)),
  ];
}

export interface SwapCheck extends SwapResult {
  violations: Violation[];
}

/**
 * Check a response and apply it, so a test can assert on the resulting page.
 *
 * The point of returning both: "no violations" and "the page still looks right
 * afterwards" are different claims, and the second one is what a reviewer
 * actually wants to see in a test about deleting the last row of a list.
 */
export async function swapAndCheck(options: ResponseOptions): Promise<SwapCheck> {
  const violations = await checkResponse(options);
  const result = await applySwap(options);
  return { ...result, violations };
}

/** A one-line summary of a violation list, for test failure messages. */
export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return "no violations";
  return violations
    .map(
      (v) => `  [${v.rule}] ${v.message}${v.detail === undefined ? "" : `\n      ${v.detail}`}`,
    )
    .join("\n");
}
