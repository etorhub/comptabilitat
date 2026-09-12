/**
 * Les seccions de l'`AGENTS.md` que surten del codi.
 *
 * L'`AGENTS.md` no es documentacio de cortesia: es el manual que llegeix qui
 * toca aquest codi, persona o agent, i s'hi confia. Quan una part queda
 * enrere, no es que estigui desendreçada —es que menteix, i algu hi treballa a
 * sobre.
 *
 * Ja ha passat. La taula dels intercanvis fora de banda en llistava **tres**
 * quan el codi ja en dibuixava **tretze**, i aixo despres d'un commit
 * (`a3a9457`) dedicat expressament a reconciliar el document amb el codi. Una
 * llista escrita a ma al costat del codi se n'acaba separant sempre; l'unica
 * manera que no passi es que no sigui a ma.
 *
 * Per aixo aquestes seccions **es generen**:
 *
 *   bun run docs         les torna a escriure
 *   bun run docs:check   falla si no encaixen (va dins de `bun run check`)
 *
 * Cada seccio viu entre dues marques HTML dins de l'`AGENTS.md`. El que hi ha
 * fora no es toca mai: el document continua sent escrit per persones, i nomes
 * aquests trossos surten del codi.
 *
 * Afegir-ne una es afegir una entrada a `SECCIONS`.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { OOB_TARGETS } from "../src/lib/oob.ts";

const Root = resolve(import.meta.dir, "..");

interface Seccio {
  /** El nom que surt a les marques: `<!-- generat:<nom> -->`. */
  name: string;
  /** En quin fitxer viu, relatiu a l'arrel. */
  file: string;
  genera: () => Promise<string> | string;
}

/** Els objectius fora de banda, tal com els declara `src/lib/oob.ts`. */
function tableOob(): string {
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
 * Els recursos de `src/routes/`, amb quins dels quatre fitxers tenen.
 *
 * La regla dels quatre fitxers es de l'`AGENTS.md`, i fins ara ningu no la
 * comprovava: es llegia i es confiava.
 */
async function resourcesTable(): Promise<string> {
  const base = join(Root, "src", "routes");
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
 * Les seccions generades viuen a `docs/`, no a l'`AGENTS.md`.
 *
 * L'`AGENTS.md` es el que ha de caber a la finestra de qui treballa; aquestes
 * dues taules son material de consulta i sumen mes de cent linies. Qui necessiti
 * la llista sencera d'objectius fora de banda la te aqui —i, sobretot, la te al
 * `src/lib/oob.ts`, que es on el `tsc` l'hi dira.
 */
const SECCIONS: Seccio[] = [
  { name: "oob", file: "docs/referencia.md", genera: tableOob },
  { name: "recursos", file: "docs/referencia.md", genera: resourcesTable },
];

function marques(name: string): { inici: string; fi: string } {
  return { inici: `<!-- generat:${name} -->`, fi: `<!-- /generat:${name} -->` };
}

/**
 * Passa el text pel Prettier, amb la configuracio del projecte.
 *
 * Sense aixo, el generador i el `format` es barallen: el generador escriu les
 * taules amb les barres juntes i el Prettier les alinea, de manera que
 * `bun run docs` seguit de `bun run format` deixava el `docs:check` vermell
 * sense que ningu hagues tocat res. Val mes que el generador escrigui d'entrada
 * el que el Prettier escriuria.
 */
async function withPrettier(text: string): Promise<string> {
  const proc = Bun.spawn(
    [join(Root, "node_modules", ".bin", "prettier"), "--parser", "markdown"],
    { stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" },
  );
  const [output, error, codi] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (codi !== 0) throw new Error(`El Prettier ha fallat:\n${error}`);
  return output;
}

/** Un fitxer amb les seves seccions generades al dia. */
export async function upToDate(original: string, seccions: Seccio[]): Promise<string> {
  let text = original;

  for (const seccio of seccions) {
    const { inici, fi } = marques(seccio.name);
    const desde = text.indexOf(inici);
    const fins = text.indexOf(fi);

    if (desde === -1 || fins === -1 || fins < desde) {
      throw new Error(
        `A ${seccio.file} hi falten les marques de la seccio "${seccio.name}".\n` +
          `Han de ser-hi totes dues, en aquest ordre:\n  ${inici}\n  ${fi}`,
      );
    }

    const content = await seccio.genera();
    text = text.slice(0, desde + inici.length) + "\n\n" + content + "\n\n" + text.slice(fins);
  }

  return withPrettier(text);
}

async function principal(): Promise<void> {
  const check = process.argv.includes("--check");

  const perFile = new Map<string, Seccio[]>();
  for (const seccio of SECCIONS) {
    perFile.set(seccio.file, [...(perFile.get(seccio.file) ?? []), seccio]);
  }

  const endarrerits: string[] = [];

  for (const [file, seccions] of perFile) {
    const path = join(Root, file);
    const original = await Bun.file(path).text();
    const fresh = await upToDate(original, seccions);
    if (original === fresh) continue;

    if (check) {
      endarrerits.push(file);
      continue;
    }
    await Bun.write(path, fresh);
    console.log(`[docs] ${file} actualitzat.`);
  }

  if (endarrerits.length === 0) {
    if (!check) console.log("[docs] les seccions generades son al dia.");
    else console.log("[docs] les seccions generades son al dia.");
    return;
  }

  console.error(
    `[docs] les seccions generades no encaixen amb el codi: ${endarrerits.join(", ")}\n\n` +
      "Surten de `src/lib/oob.ts` i de `src/routes/`; no s'editen a ma.\n" +
      "Passa-hi `bun run docs` i torna a comprovar.",
  );
  process.exit(1);
}

if (import.meta.main) await principal();
