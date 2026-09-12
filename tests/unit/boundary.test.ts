/**
 * The boundary check, against made-up directories.
 *
 * It exists because `scripts/boundary.ts` once reported that everything was
 * fine while it searched for imports in a source it had just stripped the
 * string literals from — that is, where it could not find a single one. A
 * check that is not tested is just a way of feeling reassured.
 *
 * No database needed.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBoundary } from "../../scripts/boundary.ts";

let root = "";
const EXTRACTABLE = [{ dir: "package", packages: ["bun:test"] }];

async function write(name: string, content: string): Promise<void> {
  await writeFile(join(root, "package", name), content, "utf8");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "boundary-"));
  await mkdir(join(root, "package"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
});

afterAll(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
});

describe("imports", () => {
  test("a file that only looks at itself passes", async () => {
    await write(
      "index.ts",
      `import { helper } from "./helper.ts";\nexport const value = helper;\n`,
    );
    await write("helper.ts", `export const helper = 1;\n`);
    expect(await checkBoundary(EXTRACTABLE, root)).toEqual([]);
  });

  test("importing from outside the directory is a problem", async () => {
    await write(
      "index.ts",
      `import { config } from "../src/config.ts";\nexport const v = config;\n`,
    );
    const problems = await checkBoundary(EXTRACTABLE, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain("outside package/");
    expect(problems[0]?.line).toBe(1);
  });

  test("so is a package that is not on the allowlist", async () => {
    await write("index.ts", `import { z } from "zod";\nexport const v = z;\n`);
    const problems = await checkBoundary(EXTRACTABLE, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain("allowlist");
  });

  test("the allowed ones are not", async () => {
    await write("index.ts", `import { test } from "bun:test";\nexport const v = test;\n`);
    expect(await checkBoundary(EXTRACTABLE, root)).toEqual([]);
  });

  test("an `export … from` counts the same as an `import`", async () => {
    await write("index.ts", `export { config } from "../src/config.ts";\n`);
    const problems = await checkBoundary(EXTRACTABLE, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain("outside package/");
  });

  test("an import inside a comment does not count", async () => {
    await write(
      "index.ts",
      `// import { config } from "../src/config.ts";\nexport const v = 1;\n`,
    );
    expect(await checkBoundary(EXTRACTABLE, root)).toEqual([]);
  });

  test("an import specifier is a string, and strings are where it has to look", async () => {
    // The regression: stripping string literals before searching found nothing
    // at all, and nothing at all looks exactly like nothing wrong.
    await write(
      "index.ts",
      `const s = "not an import";\nimport { x } from "../src/x.ts";\nexport const v = [s, x];\n`,
    );
    const problems = await checkBoundary(EXTRACTABLE, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
  });
});
