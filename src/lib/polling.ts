/**
 * The application's polls.
 *
 * There are two — the state of an import on `/connexions`, and the running
 * jobs on `/feines` — and they are the one exception to the `AGENTS.md` rule
 * that says never to poll.
 *
 * Both of them used to stop **only** when the server said the work had
 * finished. That is correct as long as the work finishes. When it does not — a
 * `docker compose stop` in the middle of an import leaves the row `running`
 * for ever — the page keeps asking every two seconds, indefinitely, for
 * everyone looking at it. It happened (`f80df91`), and the poll said nothing
 * about it: the markup of one that will stop and one that never will are
 * identical.
 *
 * Now the attempt counter travels **in the URL being polled**. It is
 * server-authoritative and holds no client state, like everything else here:
 * each response asks for the next attempt, and when they run out the fragment
 * stops emitting a trigger and shows that it has given up.
 *
 * This file is the thin application layer; the mechanism lives in
 * `htmx-contract/poll.ts`, which is English because it has to be able to leave.
 */

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

import { pollAttributes, readAttempt } from "../../htmx-contract/poll.ts";

/** The query parameter the counter rides in. Catalan, like the rest of the URL. */
export const ATTEMPT_PARAM = "intent";

/**
 * Thirty minutes at two seconds.
 *
 * Generous on purpose. The nightly maintenance job already closes imports that
 * have not moved for two hours, and under PSD2 a genuinely live import stops
 * another one from starting: better that the poll gives up late than that it
 * gives up while the work is still running.
 */
export const MAX_ATTEMPTS = 900;

export interface PollOptions {
  /** The URL of the fragment being polled. */
  url: string;
  /** Where the response goes. */
  target: string;
  /** Which attempt rendered this. The first one is 0. */
  attempt: number;
  /** How many seconds between attempts. */
  everySeconds?: number;
  maxAttempts?: number;
}

/**
 * The attributes for one more attempt, or `""` when there are none left.
 *
 * The caller must check `pollExhausted()` to show that it has given up: it is
 * not enough to stop emitting the trigger silently, because then the page sits
 * there showing a spinner that will never move.
 */
export function poll(options: PollOptions): HtmlEscapedString | "" {
  const attributes = pollAttributes({
    url: options.url,
    target: options.target,
    everyMs: (options.everySeconds ?? 2) * 1000,
    attempt: options.attempt,
    maxAttempts: options.maxAttempts ?? MAX_ATTEMPTS,
    attemptParam: ATTEMPT_PARAM,
  });
  return attributes === null ? "" : (raw(attributes) as HtmlEscapedString);
}

/** Whether this attempt is already past the limit. */
export function pollExhausted(attempt: number, maxAttempts = MAX_ATTEMPTS): boolean {
  return attempt >= maxAttempts;
}

/** The attempt counter as it arrives in the query string. */
export function attemptFromQuery(value: string | null | undefined): number {
  return readAttempt(value);
}
