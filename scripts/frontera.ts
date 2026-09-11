/**
 * La frontera dels directoris que algun dia han de marxar.
 *
 * `htmx-contract/` no es d'aquesta aplicacio: es una peça que s'ha de poder
 * endur a un paquet seu amb un `git mv` i prou. Perque aixo continui sent cert
 * sense que ningu se'n recordi, aqui es comprova el que **si** que es pot
 * comprovar del tot:
 *
 *   1. Que no importa res de `src/`, de `tests/`, ni de fora del seu directori.
 *   2. Que no importa cap paquet que no sigui a la llista blanca.
 *
 * I, com a **heuristica declarada**, que els identificadors que declara son en
 * angles. Aixo ultim no es exacte i no pretén ser-ho: la regla de la casa diu
 * que l'aplicacio es en catala i les peces extraibles en angles, i el que
 * realment passa quan algu s'ho descuida es escriure-hi un
 * `function comprovaResposta` per inercia. Aixo es el que busca.
 *
 * **Els comentaris i els textos no es miren.** Un comentari que cita el titol
 * d'un commit («Un error deixava de menjar-se la fila que estaves tocant») es
 * en catala amb tota la rao, i el marcatge de `fixtures.ts` es una copia
 * reduida del que dibuixa l'aplicacio, que es en catala per definicio. El que
 * ha de ser en angles es l'API i els noms.
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** Els directoris que han de poder marxar, i el que se'ls permet importar. */
const EXTRAIBLES = [{ dir: "htmx-contract", paquets: ["bun:test"] }] as const;

const ARREL = resolve(import.meta.dir, "..");

export interface Problema {
  fitxer: string;
  linia: number;
  motiu: string;
}

/**
 * Paraules catalanes que no son tambe angleses.
 *
 * Llista curta a proposit: val mes deixar passar algun cas que no pas fer
 * fallar la comprovacio per una paraula que en angles vol dir una altra cosa.
 * `camp`, `proves` o `per` no hi son per aixo mateix.
 */
const PARAULES = [
  "adreca",
  "adreça",
  "aixo",
  "amb",
  "aquesta",
  "avis",
  "buit",
  "cadena",
  "capcalera",
  "capçalera",
  "cerca",
  "comprova",
  "consulta",
  "dels",
  "dibuixa",
  "esborra",
  "escriu",
  "espai",
  "feina",
  "fitxer",
  "galeta",
  "intercanvi",
  "llista",
  "missatge",
  "moviment",
  "nomes",
  "pagina",
  "peticio",
  "plantilla",
  "perque",
  "resposta",
  "sencera",
  "sondeig",
  "taula",
  "testimoni",
  "torna",
];

const PARAULES_SET = new Set(PARAULES);

/**
 * Treu els comentaris, i opcionalment els textos.
 *
 * Son dues passades diferents a proposit. Les importacions **son** textos, de
 * manera que buscar-les en una font sense textos no en troba ni una —cosa que
 * aquest fitxer ja ha fet una vegada, deixant passar un `import` de `src/` i un
 * paquet de fora de la llista mentre deia que tot estava be. Els noms
 * declarats, en canvi, s'han de buscar sense textos, perque si no el marcatge
 * catala de `fixtures.ts` surt com si fos un identificador.
 *
 * Les linies es conserven perque els numeros que surten a l'informe siguin els
 * del fitxer de debo.
 */
function neteja(font: string, { textos }: { textos: boolean }): string {
  let out = "";
  let i = 0;
  while (i < font.length) {
    const c = font[i];
    const seguent = font[i + 1];

    if (c === "/" && seguent === "/") {
      while (i < font.length && font[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && seguent === "*") {
      i += 2;
      while (i < font.length && !(font[i] === "*" && font[i + 1] === "/")) {
        if (font[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (!textos && (c === '"' || c === "'" || c === "`")) {
      const cometa = c;
      i++;
      while (i < font.length && font[i] !== cometa) {
        if (font[i] === "\\") i++;
        else if (font[i] === "\n") out += "\n";
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Els especificadors d'importacio, amb el numero de linia. */
function importacions(font: string): { spec: string; linia: number }[] {
  const out: { spec: string; linia: number }[] = [];
  const patro = /(?:\bfrom\s*|(?:\bimport|\brequire)\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = patro.exec(font)) !== null) {
    const spec = match[1];
    if (spec === undefined) continue;
    out.push({ spec, linia: font.slice(0, match.index).split("\n").length });
  }
  return out;
}

/** Els noms que declara un fitxer. */
function declaracions(codi: string): { nom: string; linia: number }[] {
  const out: { nom: string; linia: number }[] = [];
  const patro = /\b(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = patro.exec(codi)) !== null) {
    const nom = match[1];
    if (nom === undefined) continue;
    out.push({ nom, linia: codi.slice(0, match.index).split("\n").length });
  }
  return out;
}

/** `comprovaResposta` → ["comprova", "resposta"] */
function trossos(nom: string): string[] {
  return nom
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[\s_$]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

async function fitxersTs(dir: string): Promise<string[]> {
  const entrades = await readdir(dir, { withFileTypes: true, recursive: true });
  return entrades
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

export interface Extraible {
  dir: string;
  paquets: readonly string[];
}

/**
 * Comprova una llista de directoris extraibles contra una arrel.
 *
 * Exportada i amb els dos parametres a fora perque `tests/frontera.test.ts` la
 * pugui cridar amb un directori de mentida. Una comprovacio que no es pot
 * provar no es una comprovacio: aquesta ja va dir un cop que tot estava be
 * mentre no mirava les importacions.
 */
export async function comprovaFrontera(
  extraibles: readonly Extraible[] = EXTRAIBLES,
  arrel: string = ARREL,
): Promise<Problema[]> {
  const problemes: Problema[] = [];

  for (const { dir, paquets } of extraibles) {
    const base = join(arrel, dir);
    const permesos = new Set<string>(paquets);

    for (const fitxer of await fitxersTs(base)) {
      const relatiu = relative(arrel, fitxer);
      const font = await Bun.file(fitxer).text();
      const ambTextos = neteja(font, { textos: true });
      const codi = neteja(font, { textos: false });

      for (const { spec, linia } of importacions(ambTextos)) {
        if (spec.startsWith(".")) {
          const desti = resolve(fitxer, "..", spec);
          if (!desti.startsWith(base + "/")) {
            problemes.push({
              fitxer: relatiu,
              linia,
              motiu: `importa "${spec}", que es fora de ${dir}/`,
            });
          }
          continue;
        }
        if (!permesos.has(spec)) {
          problemes.push({
            fitxer: relatiu,
            linia,
            motiu: `importa el paquet "${spec}", que no es a la llista blanca de ${dir}/`,
          });
        }
      }

      for (const { nom, linia } of declaracions(codi)) {
        const catalanes = trossos(nom).filter((t) => PARAULES_SET.has(t));
        if (catalanes.length === 0) continue;
        problemes.push({
          fitxer: relatiu,
          linia,
          motiu: `\`${nom}\` sembla catala (${catalanes.join(", ")}); ${dir}/ es en angles`,
        });
      }
    }
  }

  return problemes;
}

async function principal(): Promise<void> {
  const problemes = await comprovaFrontera();

  if (problemes.length === 0) {
    const noms = EXTRAIBLES.map((e) => `${e.dir}/`).join(", ");
    console.log(`[frontera] ${noms} es pot endur tal com esta.`);
    return;
  }

  console.error("[frontera] la frontera dels directoris extraibles no es respecta:\n");
  for (const problema of problemes) {
    console.error(`  ${problema.fitxer}:${problema.linia}  ${problema.motiu}`);
  }
  console.error(
    "\nAquests directoris han de poder marxar a un paquet seu amb un `git mv`.\n" +
      "Si un d'ells necessita alguna cosa de l'aplicacio, es que la peça esta mal\n" +
      "tallada: passa-li el que necessiti com a argument.",
  );
  process.exit(1);
}

if (import.meta.main) await principal();
