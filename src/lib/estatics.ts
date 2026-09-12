/**
 * Versioned URLs for the files in `public/`.
 *
 * Static files are served with a one-year `Cache-Control: immutable`. Without a
 * `?v=` tied to the content, a deployment would leave stale CSS and JS in the
 * browser until the cache expired. The digest changes when the file changes; in
 * development, `css:watch` shows up on a page refresh without restarting the
 * server, because the local cache keys on mtime.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "../../public");

interface CacheEntry {
  mtimeMs: number;
  digest: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * The files a template may ask for. Only these: this is not a general static
 * file server.
 */
export type StaticFile =
  "app.css" | "htmx.min.js" | "echarts.min.js" | "grafics.js" | "favicon.svg";

function digestOf(name: StaticFile): string {
  const path = join(PUBLIC, name);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    // The file may not exist yet (`app.css` before `bun run css`, say). Return
    // a stable marker so the template does not blow up.
    return "absent";
  }

  const cached = cache.get(name);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.digest;
  }

  // Synchronous read: hono/html templates render synchronously.
  const buffer = readFileSync(path);
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  cache.set(name, { mtimeMs, digest });
  return digest;
}

/** A versioned URL: `/app.css?v=a1b2c3d4`. */
export function staticHref(name: StaticFile): string {
  return `/${name}?v=${digestOf(name)}`;
}
