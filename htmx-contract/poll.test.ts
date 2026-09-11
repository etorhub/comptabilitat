/**
 * Bounded polling.
 *
 * The bug behind this is `f80df91`: a poll that stopped only on a terminal
 * state, and work that never reached one. The markup of a poll that will stop
 * and one that never will is otherwise identical, which is why the bound has to
 * be declared rather than implied.
 */

import { describe, expect, test } from "bun:test";

import { checkDocument, type RuleName, type Violation } from "./index.ts";
import { pollAttributes, readAttempt } from "./poll.ts";

function rules(violations: Violation[]): RuleName[] {
  return violations.map((v) => v.rule);
}

describe("pollAttributes", () => {
  const base = { url: "/status", target: "#s", attempt: 0, maxAttempts: 3 };

  test("asks for the next attempt, carrying the counter in the URL", () => {
    expect(pollAttributes(base)).toContain('hx-get="/status?attempt=1"');
    expect(pollAttributes({ ...base, attempt: 1 })).toContain('hx-get="/status?attempt=2"');
  });

  test("keeps an existing query string", () => {
    const attrs = pollAttributes({ ...base, url: "/status?id=4" });
    expect(attrs).toContain('hx-get="/status?id=4&attempt=1"');
  });

  test("declares the bound, so the rule can see it", () => {
    expect(pollAttributes(base)).toContain('data-poll-max="3"');
  });

  test("returns null on the last attempt instead of arming one more", () => {
    expect(pollAttributes({ ...base, attempt: 2 })).not.toBeNull();
    expect(pollAttributes({ ...base, attempt: 3 })).toBeNull();
    expect(pollAttributes({ ...base, attempt: 99 })).toBeNull();
  });

  test("writes whole seconds as seconds and the rest as milliseconds", () => {
    expect(pollAttributes({ ...base, everyMs: 2000 })).toContain('hx-trigger="every 2s"');
    expect(pollAttributes({ ...base, everyMs: 500 })).toContain('hx-trigger="every 500ms"');
  });

  test("refuses nonsense rather than polling for ever by accident", () => {
    expect(() => pollAttributes({ ...base, attempt: -1 })).toThrow(RangeError);
    expect(() => pollAttributes({ ...base, maxAttempts: 0 })).toThrow(RangeError);
    expect(() => pollAttributes({ ...base, attempt: Number.NaN })).toThrow(RangeError);
  });

  test("what it emits satisfies unbounded-poll; the hand-written form does not", async () => {
    const bounded = `<div ${pollAttributes(base)}></div>`;
    expect(rules(await checkDocument(bounded, { fragment: true }))).not.toContain(
      "unbounded-poll",
    );

    const byHand = `<div hx-get="/status" hx-target="#s" hx-trigger="every 2s"></div>`;
    expect(rules(await checkDocument(byHand, { fragment: true }))).toContain("unbounded-poll");
  });
});

describe("readAttempt", () => {
  test("reads a counter", () => {
    expect(readAttempt("0")).toBe(0);
    expect(readAttempt("41")).toBe(41);
  });

  test("treats anything else as starting over", () => {
    // It arrives from the URL, which is the one input here a person can edit.
    // Starting over is harmless; trusting NaN is not.
    for (const value of [null, undefined, "", "-1", "1.5", "abc", "9e99", " 3"]) {
      expect(readAttempt(value)).toBe(0);
    }
  });
});
