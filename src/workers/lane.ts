/**
 * A single lane for the jobs that use the local model.
 *
 * On a NAS without a graphics card one model call keeps the CPU busy for
 * minutes, and Ollama answers one request at a time (`OLLAMA_NUM_PARALLEL=1`).
 * Two model jobs overlapping would not go faster: they would both go slower,
 * and a chat question in between would wait behind both. So every job that
 * talks to the model goes through here and they run one after another, even
 * when one of them runs long and the next one's cron fires.
 *
 * It lives in the worker's memory: no table, no broker. It does not have to
 * survive a restart, because the cron schedules them again the next day.
 */

export type Lane = <T>(job: () => Promise<T>) => Promise<T>;

export function createLane(): Lane {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    // The next job waits for this one whether it worked or not.
    tail = run.catch(() => undefined);
    return run;
  };
}
