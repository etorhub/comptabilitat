/**
 * Polling that stops.
 *
 * htmx polls with `hx-trigger="every 2s"`, and the usual way to stop is for the
 * server to return a fragment without the trigger once the work reaches a
 * terminal state. That works right up until the work *never* reaches one —
 * the process is killed mid-run, the row stays `running` for ever, and the page
 * asks again every two seconds, indefinitely, for every viewer. That is
 * `f80df91`, and nothing about the polling itself made it visible.
 *
 * The fix here is a bound the server controls. There is no client state to hold
 * it in and no client state wanted, so the counter rides in the polled URL: each
 * response asks for the next attempt, and when the count runs out the server
 * stops emitting a trigger and says so instead.
 *
 * Two things follow from the bound being declared rather than implied:
 *
 *   - `unbounded-poll` in `rules.ts` can tell a bounded poll from an unbounded
 *     one, because a bounded one carries `data-poll-max`;
 *   - "how long will this poll for, at worst" has an answer you can read off
 *     the markup, without tracing the terminal states of a state machine.
 */

import { BOUNDED_POLL_ATTR } from "./inspect.ts";

export interface PollOptions {
  /** The fragment URL to poll. The attempt parameter is appended to it. */
  url: string;
  /** Where the response goes. */
  target: string;
  /** Swap style. Polling fragments almost always replace themselves. */
  swap?: string;
  /** Interval between attempts. */
  everyMs?: number;
  /** Which attempt produced this render. The first one is 0. */
  attempt: number;
  /** How many attempts before giving up. */
  maxAttempts: number;
  /** The query parameter the counter rides in. */
  attemptParam?: string;
}

/**
 * The attributes for one more attempt, or null when there are none left.
 *
 * Null is the whole point: the caller renders a terminal state instead, rather
 * than quietly emitting a trigger that will never stop.
 */
export function pollAttributes(options: PollOptions): string | null {
  const {
    url,
    target,
    swap = "outerHTML",
    everyMs = 2000,
    attempt,
    maxAttempts,
    attemptParam = "attempt",
  } = options;

  if (!Number.isFinite(attempt) || attempt < 0) throw new RangeError("attempt must be >= 0");
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be >= 1");
  }
  if (attempt >= maxAttempts) return null;

  const separator = url.includes("?") ? "&" : "?";
  const next = `${url}${separator}${attemptParam}=${attempt + 1}`;
  const interval = everyMs % 1000 === 0 ? `${everyMs / 1000}s` : `${everyMs}ms`;

  return (
    `hx-get="${next}" hx-target="${target}" hx-swap="${swap}" ` +
    `hx-trigger="every ${interval}" ${BOUNDED_POLL_ATTR}="${maxAttempts}"`
  );
}

/**
 * Read an attempt counter off a query string.
 *
 * Anything that is not a non-negative integer reads as 0, because the counter
 * arrives from the URL and the URL is the one thing here a person can edit.
 * Starting over is harmless; trusting `NaN` is not.
 */
export function readAttempt(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (!/^\d+$/.test(value)) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
