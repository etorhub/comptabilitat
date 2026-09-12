/**
 * The out-of-band swap targets.
 *
 * **This file is the source of truth, and the table in `docs/reference.md`
 * comes out of it.** `bun run docs` rewrites that table and `bun run docs:check`
 * (inside `bun run check`) fails CI when it no longer matches. The documentation
 * cannot fall behind, because it does not exist separately: nobody has to
 * remember to update it.
 *
 * That was needed. The table listed **three** targets while the code already
 * rendered **thirteen** — and that was after a commit (`a3a9457`) devoted
 * expressly to reconciling the document with the code. A list written by hand
 * next to the code drifts away from it again; the only way it cannot is for it
 * not to be written by hand.
 *
 * **And the registry is load-bearing, not decorative.** Components ask
 * `oobAttributes()` for their attributes, and it only accepts keys from here:
 * a new target that is not registered does not compile. A registry nobody
 * imports is exactly as fragile as the table it replaces.
 */

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * How a target is swapped.
 *
 * Nearly all of them are `outerHTML`: the whole node arrives and replaces what
 * was there. `#toast` is not, and the reason is in `lib/http.ts`: replacing the
 * whole node would mean the replacement has to carry `aria-live`, and the
 * browser only announces a live region that already existed when the text was
 * put into it.
 */
export type OobMode = "outerHTML" | "innerHTML";

export interface OobTarget {
  /** Which module renders it. */
  owner: string;
  /** When it changes. */
  when: string;
  mode: OobMode;
}

/**
 * The ids stay Catalan: they are part of the markup the browser sees, like the
 * URLs. Everything said *about* them is English.
 */
export const OOB_TARGETS = {
  toast: {
    owner: "lib/http.ts",
    when: "any error or confirmation",
    mode: "innerHTML",
  },
  "comptador-revisio": {
    owner: "components/layout.ts",
    when: "a transaction is categorised",
    mode: "outerHTML",
  },
  "comptador-avisos": {
    owner: "components/layout.ts",
    when: "an alert is read or dismissed",
    mode: "outerHTML",
  },
  "arbre-categories": {
    owner: "routes/categories",
    when: "a category is created, changed or deleted",
    mode: "outerHTML",
  },
  "filtre-targetes": {
    owner: "routes/transactions",
    when: "the workspace's known cards change",
    mode: "outerHTML",
  },
  "taula-recurrents-propostes": {
    owner: "routes/recurring",
    when: "a proposal is confirmed or dismissed",
    mode: "outerHTML",
  },
  "taula-recurrents-actives": {
    owner: "routes/recurring",
    when: "a series is confirmed, changed or dismissed",
    mode: "outerHTML",
  },
  "llista-connexions": {
    owner: "routes/connections",
    when: "an account is connected, moved or deleted",
    mode: "outerHTML",
  },
  "llista-usuaris": {
    owner: "routes/users",
    when: "a user is created, changed or deleted",
    mode: "outerHTML",
  },
  "llista-feines": {
    owner: "routes/jobs",
    when: "a job's configuration changes",
    mode: "outerHTML",
  },
  "historial-feines": {
    owner: "routes/jobs",
    when: "a run finishes",
    mode: "outerHTML",
  },
  "en-curs": {
    owner: "routes/jobs",
    when: "a job starts or finishes",
    mode: "outerHTML",
  },
  "agenda-salut": {
    owner: "routes/jobs",
    when: "the scheduler's state changes",
    mode: "outerHTML",
  },
} as const satisfies Record<string, OobTarget>;

export type OobId = keyof typeof OOB_TARGETS;

/**
 * A target's `id` and, when it applies, its `hx-swap-oob`.
 *
 * This replaces the hand-written `id="..."` plus the
 * `${oob ? raw('hx-swap-oob="true"') : ""}` that was repeated in eleven places.
 * The type of `id` is what ties the registry to the code: a target that is not
 * in it does not compile.
 */
export function oobAttributes(id: OobId, oob = false): HtmlEscapedString {
  return raw(`id="${id}"${oob ? ' hx-swap-oob="true"' : ""}`) as HtmlEscapedString;
}

/**
 * The attribute for a wrapper that replaces a target's **content**.
 *
 * Only for `innerHTML` targets: the node being rendered is not the target
 * itself but a box carrying the new content towards it.
 */
export function oobWrapper(id: OobId): HtmlEscapedString {
  return raw(`hx-swap-oob="innerHTML:#${id}"`) as HtmlEscapedString;
}
