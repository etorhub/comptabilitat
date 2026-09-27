/**
 * The worker's model lane: jobs that use the local model never overlap.
 */

import { expect, test } from "bun:test";

import { createLane } from "../../src/workers/lane.ts";

test("jobs run one after another, never at once", async () => {
  const lane = createLane();
  const log: string[] = [];
  let running = 0;
  let most = 0;

  const job = (name: string, ms: number) => async () => {
    running += 1;
    most = Math.max(most, running);
    log.push(`${name}:start`);
    await Bun.sleep(ms);
    log.push(`${name}:end`);
    running -= 1;
    return name;
  };

  const results = await Promise.all([lane(job("a", 20)), lane(job("b", 1)), lane(job("c", 5))]);

  expect(results).toEqual(["a", "b", "c"]);
  expect(most).toBe(1);
  expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
});

test("a job that fails does not stop the ones behind it", async () => {
  const lane = createLane();
  const failing = lane(async () => {
    throw new Error("caigut");
  });
  const next = lane(async () => "fet");

  await expect(failing).rejects.toThrow("caigut");
  expect(await next).toBe("fet");
});
