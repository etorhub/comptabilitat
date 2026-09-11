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

import { OBJECTIUS_OOB } from "../src/lib/oob.ts";

const ARREL = resolve(import.meta.dir, "..");
const AGENTS = join(ARREL, "AGENTS.md");

interface Seccio {
  /** El nom que surt a les marques: `<!-- generat:<nom> -->`. */
  nom: string;
  genera: () => Promise<string> | string;
}

/** Els objectius fora de banda, tal com els declara `src/lib/oob.ts`. */
function taulaOob(): string {
  const files = Object.entries(OBJECTIUS_OOB).map(([id, o]) => {
    const objectiu = `\`#${id}\``;
    const mode = o.mode === "innerHTML" ? " _(contingut)_" : "";
    return `| ${objectiu}${mode} | ${o.amo} | ${o.quan} |`;
  });

  return [
    "| Objectiu | De qui és | Quan canvia |",
    "| -------- | --------- | ----------- |",
    ...files,
  ].join("\n");
}

/**
 * Els recursos de `src/routes/`, amb quins dels quatre fitxers tenen.
 *
 * La regla dels quatre fitxers es de l'`AGENTS.md`, i fins ara ningu no la
 * comprovava: es llegia i es confiava.
 */
async function taulaRecursos(): Promise<string> {
  const base = join(ARREL, "src", "routes");
  const entrades = await readdir(base, { withFileTypes: true });
  const recursos = entrades
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .toSorted();

  const files: string[] = [];
  for (const recurs of recursos) {
    const seus = new Set(await readdir(join(base, recurs)));
    const te = (sufix: string) => (seus.has(`${recurs}.${sufix}.ts`) ? "sí" : "—");
    files.push(
      `| \`${recurs}/\` | ${te("routes")} | ${te("page")} | ${te("fragment")} | ${te("schema")} |`,
    );
  }

  return [
    "| Recurs | `.routes` | `.page` | `.fragment` | `.schema` |",
    "| ------ | --------- | ------- | ----------- | --------- |",
    ...files,
  ].join("\n");
}

const SECCIONS: Seccio[] = [
  { nom: "oob", genera: taulaOob },
  { nom: "recursos", genera: taulaRecursos },
];

function marques(nom: string): { inici: string; fi: string } {
  return { inici: `<!-- generat:${nom} -->`, fi: `<!-- /generat:${nom} -->` };
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
async function ambPrettier(text: string): Promise<string> {
  const proc = Bun.spawn(
    [join(ARREL, "node_modules", ".bin", "prettier"), "--parser", "markdown"],
    { stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" },
  );
  const [sortida, error, codi] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (codi !== 0) throw new Error(`El Prettier ha fallat:\n${error}`);
  return sortida;
}

/** L'`AGENTS.md` amb totes les seccions generades al dia. */
export async function agentsMdAlDia(original: string): Promise<string> {
  let text = original;

  for (const seccio of SECCIONS) {
    const { inici, fi } = marques(seccio.nom);
    const desde = text.indexOf(inici);
    const fins = text.indexOf(fi);

    if (desde === -1 || fins === -1 || fins < desde) {
      throw new Error(
        `A l'AGENTS.md hi falten les marques de la seccio "${seccio.nom}".\n` +
          `Han de ser-hi totes dues, en aquest ordre:\n  ${inici}\n  ${fi}`,
      );
    }

    const contingut = await seccio.genera();
    text = text.slice(0, desde + inici.length) + "\n\n" + contingut + "\n\n" + text.slice(fins);
  }

  return ambPrettier(text);
}

async function principal(): Promise<void> {
  const comprova = process.argv.includes("--check");
  const original = await Bun.file(AGENTS).text();
  const alDia = await agentsMdAlDia(original);

  if (original === alDia) {
    console.log("[docs] les seccions generades de l'AGENTS.md son al dia.");
    return;
  }

  if (!comprova) {
    await Bun.write(AGENTS, alDia);
    console.log("[docs] AGENTS.md actualitzat.");
    return;
  }

  console.error(
    "[docs] les seccions generades de l'AGENTS.md no encaixen amb el codi.\n\n" +
      "Surten de `src/lib/oob.ts` i de `src/routes/`; no s'editen a ma.\n" +
      "Passa-hi `bun run docs` i torna a comprovar.",
  );
  process.exit(1);
}

if (import.meta.main) await principal();
