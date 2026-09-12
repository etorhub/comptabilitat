/**
 * The checks, one after another, saying which one failed.
 *
 * This used to be a chain of five `&&` inside `package.json`. When it broke,
 * what came out was the raw output of whichever tool had failed — sometimes a
 * hundred lines of `tsc` — with nothing saying **which** of the five it was or
 * what to do. Whoever already knows does not need it; whoever does not is
 * exactly who is reading it.
 *
 * Here each step carries its name and how to fix it, and the end says so in
 * one line. No magic: the same chain, with labels.
 */

interface Step {
  name: string;
  command: string[];
  /** What whoever sees it red has to do. */
  fix: string;
}

const STEPS: Step[] = [
  {
    name: "types",
    command: ["bun", "run", "typecheck"],
    fix: "Fix what `tsc` reports. Do not reach for `any` or `!`.",
  },
  {
    name: "lint",
    command: ["bun", "run", "lint"],
    fix: "Fix what oxlint reports.",
  },
  {
    name: "format",
    command: ["bun", "run", "format:check"],
    fix: "Run `bun run format`. Nothing needs fixing by hand.",
  },
  {
    name: "boundary",
    command: ["bun", "run", "boundary"],
    fix: "`htmx-contract/` may not import from the application. See AGENTS.md.",
  },
  {
    name: "docs",
    command: ["bun", "run", "docs:check"],
    fix: "Run `bun run docs`. The generated tables are not edited by hand.",
  },
];

const failed: Step[] = [];

for (const step of STEPS) {
  const proc = Bun.spawn(step.command, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) failed.push(step);
}

if (failed.length === 0) {
  console.log("\n[check] all clean.");
  process.exit(0);
}

console.error(`\n[check] failed: ${failed.map((f) => f.name).join(", ")}\n`);
for (const step of failed) {
  console.error(`  ${step.name}: ${step.fix}`);
}
console.error("");
process.exit(1);
