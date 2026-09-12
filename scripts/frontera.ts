/**
 * The boundary around the directories that are meant to leave one day.
 *
 * `htmx-contract/` is not part of this application: it is a piece that has to
 * be liftable into a package of its own with a `git mv` and nothing else. For
 * that to stay true without anyone having to remember, this checks the part
 * that can be checked completely:
 *
 *   1. that it imports nothing from `src/`, from `tests/`, or from outside its
 *      own directory;
 *   2. that it imports no package outside its allowlist.
 *
 * That dependency boundary — not word choice — is what actually stops the
 * piece from leaving, and it is exactly decidable.
 *
 * (There used to be a second, heuristic check here for Catalan identifiers,
 * from when the application was written in Catalan and only this directory was
 * English. The whole codebase is English now, so it had nothing left to find.)
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** The directories that have to be able to leave, and what they may import. */
const EXTRACTABLE = [{ dir: "htmx-contract", packages: ["bun:test"] }] as const;

const ROOT = resolve(import.meta.dir, "..");

export interface Problem {
  file: string;
  line: number;
  reason: string;
}

/** Strips comments, so an `import` inside one does not count. */
function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The import specifiers, with their line numbers.
 *
 * Note that the source keeps its string literals here: import specifiers *are*
 * strings. An earlier version of this file stripped them before searching,
 * which meant it could not find a single import — and it happily reported that
 * everything was fine while `htmx-contract/` imported `src/lib/config.ts`.
 */
function imports(source: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  const pattern = /(?:\bfrom\s*|(?:\bimport|\brequire)\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const spec = match[1];
    if (spec === undefined) continue;
    out.push({ spec, line: source.slice(0, match.index).split("\n").length });
  }
  return out;
}

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

export interface Extractable {
  dir: string;
  packages: readonly string[];
}

/**
 * Checks a list of extractable directories against a root.
 *
 * Exported, with both parameters outside, so `tests/frontera.test.ts` can call
 * it with a made-up directory. A check that cannot be tested is not a check:
 * this one once reported that everything was fine while it was not looking at
 * the imports at all.
 */
export async function checkBoundary(
  extractables: readonly Extractable[] = EXTRACTABLE,
  root: string = ROOT,
): Promise<Problem[]> {
  const problems: Problem[] = [];

  for (const { dir, packages } of extractables) {
    const base = join(root, dir);
    const allowed = new Set<string>(packages);

    for (const file of await tsFiles(base)) {
      const rel = relative(root, file);
      const source = withoutComments(await Bun.file(file).text());

      for (const { spec, line } of imports(source)) {
        if (spec.startsWith(".")) {
          const target = resolve(file, "..", spec);
          if (!target.startsWith(base + "/")) {
            problems.push({
              file: rel,
              line,
              reason: `imports "${spec}", which is outside ${dir}/`,
            });
          }
          continue;
        }
        if (!allowed.has(spec)) {
          problems.push({
            file: rel,
            line,
            reason: `imports the package "${spec}", which is not on ${dir}/'s allowlist`,
          });
        }
      }
    }
  }

  return problems;
}

async function main(): Promise<void> {
  const problems = await checkBoundary();

  if (problems.length === 0) {
    const names = EXTRACTABLE.map((e) => `${e.dir}/`).join(", ");
    console.log(`[frontera] ${names} can be lifted out as it stands.`);
    return;
  }

  console.error("[frontera] the extractable directories' boundary is not respected:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  ${problem.reason}`);
  }
  console.error(
    "\nThese directories have to be liftable into a package of their own with a\n" +
      "`git mv`. If one of them seems to need something from the application, the\n" +
      "piece is cut wrong: pass it whatever it needs as an argument.",
  );
  process.exit(1);
}

if (import.meta.main) await main();
