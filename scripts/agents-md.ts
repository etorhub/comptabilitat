/**
 * The documentation sections that come out of the code.
 *
 * `AGENTS.md` is not courtesy documentation: it is the manual whoever touches
 * this code reads — person or agent — and trusts. When a part of it falls
 * behind, it is not untidy, it is lying, and somebody is working on top of it.
 *
 * That has happened. The out-of-band table listed **three** targets while the
 * code already rendered **thirteen**, and that was after a commit (`a3a9457`)
 * devoted expressly to reconciling the document with the code. A list written
 * by hand next to the code always drifts away from it; the only way it cannot
 * is for it not to be written by hand.
 *
 * So these sections **are generated**:
 *
 *   bun run docs         rewrites them
 *   bun run docs:check   fails when they no longer match (inside `bun run check`)
 *
 * Each section lives between two HTML markers. What is outside them is never
 * touched: the documents stay written by people, and only these pieces come
 * out of the code.
 *
 * Adding one means adding an entry to `SECTIONS`.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { OOB_TARGETS } from "../src/lib/oob.ts";

const ROOT = resolve(import.meta.dir, "..");

interface Section {
  /** The name in the markers: `<!-- generat:<name> -->`. */
  name: string;
  /** Which file it lives in, relative to the root. */
  file: string;
  generate: () => Promise<string> | string;
}

/** The out-of-band targets, as `src/lib/oob.ts` declares them. */
function oobTable(): string {
  const rows = Object.entries(OOB_TARGETS).map(([id, o]) => {
    const target = `\`#${id}\``;
    const mode = o.mode === "innerHTML" ? " _(contingut)_" : "";
    return `| ${target}${mode} | ${o.owner} | ${o.when} |`;
  });

  return [
    "| Objectiu | De qui és | Quan canvia |",
    "| -------- | --------- | ----------- |",
    ...rows,
  ].join("\n");
}

/**
 * The resources under `src/routes/`, with which of the four files each has.
 *
 * The four-file rule comes from `AGENTS.md`, and until now nobody checked it:
 * it was read and trusted.
 */
async function resourcesTable(): Promise<string> {
  const base = join(ROOT, "src", "routes");
  const entrades = await readdir(base, { withFileTypes: true });
  const resources = entrades
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .toSorted();

  const rows: string[] = [];
  for (const resource of resources) {
    const seus = new Set(await readdir(join(base, resource)));
    const te = (sufix: string) => (seus.has(`${resource}.${sufix}.ts`) ? "sí" : "—");
    rows.push(
      `| \`${resource}/\` | ${te("routes")} | ${te("page")} | ${te("fragment")} | ${te("schema")} |`,
    );
  }

  return [
    "| Recurs | `.routes` | `.page` | `.fragment` | `.schema` |",
    "| ------ | --------- | ------- | ----------- | --------- |",
    ...rows,
  ].join("\n");
}

/**
 * The generated sections live in `docs/`, not in `AGENTS.md`.
 *
 * `AGENTS.md` is what has to fit in the window of whoever is working; these
 * two tables are reference material and run to more than a hundred lines.
 * Whoever needs the full list of out-of-band targets has it here — and, above
 * all, has it in `src/lib/oob.ts`, which is where `tsc` will tell them.
 */
const SECTIONS: Section[] = [
  { name: "oob", file: "docs/reference.md", generate: oobTable },
  { name: "recursos", file: "docs/reference.md", generate: resourcesTable },
];

function markers(name: string): { start: string; end: string } {
  return { start: `<!-- generat:${name} -->`, end: `<!-- /generat:${name} -->` };
}

/**
 * Runs the text through Prettier, with the project's configuration.
 *
 * Without this the generator and `format` fight: the generator writes tables
 * with the bars unaligned and Prettier aligns them, so `bun run docs` followed
 * by `bun run format` left `docs:check` red without anybody having touched
 * anything. Better that the generator write what Prettier would write in the
 * first place.
 */
async function withPrettier(text: string): Promise<string> {
  const proc = Bun.spawn(
    [join(ROOT, "node_modules", ".bin", "prettier"), "--parser", "markdown"],
    { stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" },
  );
  const [output, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`El Prettier ha fallat:\n${error}`);
  return output;
}

/** One file with its generated sections brought up to date. */
export async function upToDate(original: string, sections: Section[]): Promise<string> {
  let text = original;

  for (const section of sections) {
    const { start, end } = markers(section.name);
    const from = text.indexOf(start);
    const to = text.indexOf(end);

    if (from === -1 || to === -1 || to < from) {
      throw new Error(
        `${section.file} is missing the markers for the "${section.name}" section.\n` +
          `Both have to be there, in this order:\n  ${start}\n  ${end}`,
      );
    }

    const content = await section.generate();
    text = text.slice(0, from + start.length) + "\n\n" + content + "\n\n" + text.slice(to);
  }

  return withPrettier(text);
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");

  const perFile = new Map<string, Section[]>();
  for (const section of SECTIONS) {
    perFile.set(section.file, [...(perFile.get(section.file) ?? []), section]);
  }

  const stale: string[] = [];

  for (const [file, sections] of perFile) {
    const path = join(ROOT, file);
    const original = await Bun.file(path).text();
    const fresh = await upToDate(original, sections);
    if (original === fresh) continue;

    if (checkOnly) {
      stale.push(file);
      continue;
    }
    await Bun.write(path, fresh);
    console.log(`[docs] ${file} updated.`);
  }

  if (stale.length === 0) {
    console.log("[docs] the generated sections are up to date.");
    return;
  }

  console.error(
    `[docs] les seccions generades no encaixen amb el codi: ${stale.join(", ")}\n\n` +
      "Surten de `src/lib/oob.ts` i de `src/routes/`; no s'editen a ma.\n" +
      "Passa-hi `bun run docs` i torna a comprovar.",
  );
  process.exit(1);
}

if (import.meta.main) await main();
