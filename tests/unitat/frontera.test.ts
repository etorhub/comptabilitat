/**
 * La comprovacio de la frontera, contra directoris de mentida.
 *
 * Hi es perque `scripts/frontera.ts` ja va dir un cop que tot estava be mentre
 * buscava les importacions en una font a la qual acabava de treure els textos
 * —es a dir, mentre no en podia trobar ni una. Una comprovacio que no es prova
 * es nomes una manera de sentir-se tranquil.
 *
 * No cal base de dades.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBoundary } from "../../scripts/frontera.ts";

let root = "";
const Extractables = [{ dir: "paquet", paquets: ["bun:test"] }];

async function escriu(name: string, content: string): Promise<void> {
  await writeFile(join(root, "paquet", name), content, "utf8");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "frontera-"));
  await mkdir(join(root, "paquet"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
});

afterAll(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
});

describe("importacions", () => {
  test("un fitxer que nomes es mira a ell mateix passa", async () => {
    await escriu(
      "index.ts",
      `import { helper } from "./helper.ts";\nexport const value = helper;\n`,
    );
    await escriu("helper.ts", `export const helper = 1;\n`);
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });

  test("importar de fora del directori es un problema", async () => {
    await escriu(
      "index.ts",
      `import { config } from "../../src/config.ts";\nexport const v = config;\n`,
    );
    const problems = await checkBoundary(Extractables, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.motiu).toContain("es fora de paquet/");
    expect(problems[0]?.linia).toBe(1);
  });

  test("un paquet que no es a la llista blanca tambe", async () => {
    await escriu("index.ts", `import { z } from "zod";\nexport const v = z;\n`);
    const problems = await checkBoundary(Extractables, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.motiu).toContain("llista blanca");
  });

  test("els de la llista blanca no ho son", async () => {
    await escriu("index.ts", `import { test } from "bun:test";\nexport const v = test;\n`);
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });

  test("un `export ... from` compta igual que un `import`", async () => {
    await escriu("index.ts", `export { config } from "../../src/config.ts";\n`);
    const problems = await checkBoundary(Extractables, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.motiu).toContain("es fora de paquet/");
  });

  test("una importacio dins d'un comentari no compta", async () => {
    await escriu(
      "index.ts",
      `// import { config } from "../../src/config.ts";\nexport const v = 1;\n`,
    );
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });
});

describe("idioma", () => {
  test("un identificador catala es un problema", async () => {
    await escriu("index.ts", `export function comprovaResposta(): number {\n  return 1;\n}\n`);
    const problems = await checkBoundary(Extractables, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.motiu).toContain("sembla catala");
    expect(problems[0]?.motiu).toContain("comprova, resposta");
  });

  test("un identificador angles no ho es", async () => {
    await escriu("index.ts", `export function checkResponse(): number {\n  return 1;\n}\n`);
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });

  test("el catala dins d'un text no compta: els fixtures son marcatge de l'aplicacio", async () => {
    await escriu(
      "index.ts",
      `export const FIXTURE = "<p class='buit'>No hi ha cap regla.</p>";\n`,
    );
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });

  test("ni el catala dins d'un comentari que cita un commit", async () => {
    await escriu(
      "index.ts",
      `/** e5dd962 — "Un error deixava de menjar-se la fila que estaves tocant". */\nexport const ok = 1;\n`,
    );
    expect(await checkBoundary(Extractables, root)).toEqual([]);
  });
});
