/**
 * Fa la bastida d'un recurs nou.
 *
 *   bun run nou-recurs projectes
 *   bun run nou-recurs projectes --ruta projectes --titol "Projectes"
 *   bun run nou-recurs backups --admin
 *
 * **Per que existeix.** Afegir un recurs vol dir sis coses alhora: els quatre
 * fitxers de la regla, el registre a `src/routes/index.ts` i l'entrada a la
 * taula de `tests/contracte.test.ts`. I vol dir encertar la profunditat de les
 * importacions relatives (`../../`), que es exactament la mena de cosa que se
 * n'hi va una de cada tres.
 *
 * Escrit aixi, es una feina de consistencia entre fitxers. Fet amb una ordre,
 * es omplir els buits d'uns fitxers que ja compilen. La segona feina es molt
 * mes facil de fer be, i no nomes per a una persona cansada.
 *
 * El que surt **passa el `bun run ok` tal com esta**: una bastida que no
 * compila es pitjor que no tenir-ne, perque el primer que fa qui la fa servir
 * es preguntar-se si l'ha trencada ell.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const Root = resolve(import.meta.dir, "..");

interface Options {
  dir: string;
  ruta: string;
  titol: string;
  admin: boolean;
}

function help(message?: string): never {
  if (message) console.error(`\n[nou-recurs] ${message}\n`);
  console.error(
    "Us:\n" +
      "  bun run nou-recurs <nom> [--ruta <segment>] [--titol <Titol>] [--admin]\n\n" +
      "  <nom>      el directori de src/routes/, en angles i en plural (projects)\n" +
      "  --ruta     el segment de l'adreça, en catala (projectes). Per defecte, <nom>\n" +
      "  --titol    el que surt a la pagina. Per defecte, <ruta> amb majuscula\n" +
      "  --admin    recurs d'administracio de la instal·lacio, fora de cap espai\n",
  );
  process.exit(1);
}

function readOptions(argv: string[]): Options {
  const lliures: string[] = [];
  const nomenats = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      lliures.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "admin") {
      nomenats.set("admin", "si");
      continue;
    }
    const valor = argv[++i];
    if (valor === undefined) help(`A --${key} li falta el valor.`);
    nomenats.set(key, valor);
  }

  const dir = lliures[0];
  if (dir === undefined) help("Digues com s'ha de dir el recurs.");
  if (!/^[a-z][a-z0-9-]*$/.test(dir)) {
    help(`«${dir}» no serveix de nom: minuscules, xifres i guions, i comença per lletra.`);
  }

  const ruta = nomenats.get("ruta") ?? dir;
  const titol = nomenats.get("titol") ?? ruta.charAt(0).toUpperCase() + ruta.slice(1);
  return { dir, ruta, titol, admin: nomenats.has("admin") };
}

/** `projectes` → `Projectes`; `bank-connections` → `BankConnections`. */
function enPascal(name: string): string {
  return name
    .split("-")
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join("");
}

/** `bank-connections` → `bankConnections`. */
function enCamell(name: string): string {
  const pascal = enPascal(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// --- Els quatre fitxers -----------------------------------------------------

function fileSchema(o: Options): string {
  return `/**
 * Esquemes del recurs de ${o.ruta}.
 *
 * Un esquema per recurs, i **la taula de Drizzle es la font de veritat**: quan
 * validis una fila, deriva'l amb \`drizzle-zod\` i refina'l, no al reves.
 */

import { z } from "zod/v4";

export const PER_PAGINA = 50;

/**
 * Els filtres i la paginacio viuen a la cadena de consulta, no en cap variable
 * de client: aixi es poden enllaçar i el boto d'enrere funciona.
 */
export const ${enCamell(o.dir)}QuerySchema = z.object({
  pagina: z.coerce.number().int().min(0).default(0),
});

export type ${enPascal(o.dir)}Query = z.infer<typeof ${enCamell(o.dir)}QuerySchema>;

export function ${enCamell(o.dir)}ToQuery(q: ${enPascal(o.dir)}Query): string {
  if (q.pagina <= 0) return "";
  return \`?pagina=\${q.pagina}\`;
}
`;
}

function fileFragment(o: Options): string {
  return `/**
 * Fragments del recurs de ${o.ruta}.
 *
 * Tot el que HTMX pot demanar per separat viu aqui. Les mutacions tornen el
 * tros que ha canviat; si a mes canvien alguna cosa de fora, va al costat amb
 * \`withOob()\` i el seu objectiu ha de ser a \`src/lib/oob.ts\`.
 *
 * Per veure'n un de fet: \`src/routes/tags/\` (llista i detall) i
 * \`src/routes/categories/\` (mutacions amb intercanvi fora de banda).
 */

import { html } from "hono/html";

import { TaulaDades } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";

export interface ${enPascal(o.dir)}Vista {
  id: number;
  nom: string;
}

export function Llista({
  codi,
  items,
}: {
  codi: string;
  items: ${enPascal(o.dir)}Vista[];
}): Html {
  return html\`<div id="llista-${o.ruta}">
    \${TaulaDades({
      columnes: html\`<th>Nom</th>\` as Html,
      files: items.map(
        (item) => html\`<tr id="${o.ruta}-\${item.id}">
          <td>\${item.nom}</td>
        </tr>\` as Html,
      ),
      // Les files i l'estat buit van junts a proposit: vegeu components/vista.ts.
      buit: "Encara no hi ha res.",
    })}
    <!-- \${codi} es el codi de l'espai; fes-lo servir a les adreces d'HTMX. -->
  </div>\` as Html;
}
`;
}

function filePage(o: Options): string {
  return `/**
 * Pagina del recurs de ${o.ruta}.
 *
 * \`GET <base>\` retorna **sempre** una pagina sencera. La closca (barra
 * lateral, selector d'espai i comptadors) la posa qui crida, amb
 * \`workspacePage()\`.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { Llista, type ${enPascal(o.dir)}Vista } from "./${o.dir}.fragment.ts";

export function ${enPascal(o.dir)}Page({
  codi,
  items,
}: {
  codi: string;
  items: ${enPascal(o.dir)}Vista[];
}): Html {
  return html\`
    <header class="capçalera">
      <h1>${o.titol}</h1>
    </header>

    \${Llista({ codi, items })}
  \` as Html;
}
`;
}

function fileRoutes(o: Options): string {
  const pascal = enPascal(o.dir);
  const camell = enCamell(o.dir);

  const capçalera = o.admin
    ? `/**
 * Rutes del recurs de ${o.ruta}. Nomes per a administradors de la instal·lacio.
 *
 * GET /${o.ruta} → pagina sencera.
 * GET /${o.ruta}/fragment/llista → el fragment de la llista.
 */`
    : `/**
 * Rutes del recurs de ${o.ruta}.
 *
 * GET <base> → pagina sencera.
 * GET <base>/fragment/llista → el fragment de la llista.
 *
 * Les rutes son primes: llegir parametres, autoritzar, cridar el servei i
 * dibuixar. La logica va a \`src/services/\`.
 */`;

  const imports = o.admin
    ? `import { Hono } from "hono";

import { Layout } from "../../components/layout.ts";
import { fragment, page, pushUrl } from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { Llista, type ${pascal}Vista } from "./${o.dir}.fragment.ts";
import { ${pascal}Page } from "./${o.dir}.page.ts";
import { ${camell}QuerySchema, ${camell}ToQuery } from "./${o.dir}.schema.ts";`
    : `import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { fragment, page, pushUrl } from "../../lib/http.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { Llista, type ${pascal}Vista } from "./${o.dir}.fragment.ts";
import { ${pascal}Page } from "./${o.dir}.page.ts";
import { ${camell}QuerySchema, ${camell}ToQuery } from "./${o.dir}.schema.ts";`;

  const body = o.admin
    ? `
/** Encara no hi ha servei: torna una llista buida. Substitueix-ho. */
async function llista(): Promise<${pascal}Vista[]> {
  return [];
}

${camell}Routes.get("/", async (c) => {
  const user = currentUser(c);
  const items = await llista();

  return page(
    c,
    Layout({
      titol: "${o.titol}",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      ruta: c.req.path,
      espais: await myWorkspaces(user.id),
      children: ${pascal}Page({ codi: "", items }),
    }),
  );
});

${camell}Routes.get("/fragment/llista", async (c) => {
  const filtres = ${camell}QuerySchema.parse(c.req.query());
  const items = await llista();

  // La ruta de fragment empeny **l'adreça de la pagina**, no la seva.
  pushUrl(c, \`/${o.ruta}\${${camell}ToQuery(filtres)}\`);

  return fragment(c, Llista({ codi: "", items }));
});
`
    : `
/** Encara no hi ha servei: torna una llista buida. Substitueix-ho. */
async function llista(ledgerId: number): Promise<${pascal}Vista[]> {
  // Tota consulta ha de filtrar per l'espai, sempre. Vegeu AGENTS.md.
  void ledgerId;
  return [];
}

${camell}Routes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const items = await llista(espai.id);

  return page(
    c,
    await workspacePage(c, "${o.titol}", ${pascal}Page({ codi: espai.code, items })),
  );
});

${camell}Routes.get("/fragment/llista", async (c) => {
  const espai = currentWorkspace(c);
  const filtres = ${camell}QuerySchema.parse(c.req.query());
  const items = await llista(espai.id);

  // La ruta de fragment empeny **l'adreça de la pagina**, no la seva.
  pushUrl(c, \`/e/\${espai.code}/${o.ruta}\${${camell}ToQuery(filtres)}\`);

  return fragment(c, Llista({ codi: espai.code, items }));
});
`;

  return `${capçalera}

${imports}

export const ${camell}Routes = new Hono();
${body}`;
}

// --- Els dos fitxers que ja hi eren ----------------------------------------

function registraRuta(font: string, o: Options): string {
  const camell = enCamell(o.dir);
  const newImport = `import { ${camell}Routes } from "./${o.dir}/${o.dir}.routes.ts";`;

  if (font.includes(newImport)) return font;

  const firstImport = font.indexOf("import { alertsRoutes }");
  if (firstImport === -1)
    throw new Error("No trobo on posar l'importacio a src/routes/index.ts");
  let text = font.slice(0, firstImport) + newImport + "\n" + font.slice(firstImport);

  if (o.admin) {
    const ancora = `  app.route("/e/:codi", espai);`;
    const bulk =
      `  const ${camell} = new Hono();\n` +
      `  ${camell}.use("*", requireUser);\n` +
      `  ${camell}.use("*", requireAdmin);\n` +
      `  ${camell}.route("/", ${camell}Routes);\n` +
      `  app.route("/${o.ruta}", ${camell});\n\n`;
    if (!text.includes(ancora))
      throw new Error("No trobo l'ancora de registre a src/routes/index.ts");
    text = text.replace(ancora, bulk + ancora);
  } else {
    const ancora = `  // Les analitiques porten l'arrel de l'espai, els informes i la previsio.`;
    if (!text.includes(ancora))
      throw new Error("No trobo l'ancora de registre a src/routes/index.ts");
    text = text.replace(ancora, `  espai.route("/${o.ruta}", ${camell}Routes);\n\n${ancora}`);
  }

  return text;
}

function registraContracte(font: string, o: Options): string {
  if (font.includes(`recurs: "${o.dir}"`)) return font;

  const url = o.admin ? `/${o.ruta}` : `/e/personal/${o.ruta}`;
  const linia = `  { recurs: "${o.dir}", url: "${url}", que: "${o.titol.toLowerCase()}" },`;
  const ancora = `];\n\n/**\n * Els recursos que no tenen cap pagina`;

  if (!font.includes(ancora)) {
    throw new Error("No trobo la taula PAGINES a tests/contracte.test.ts");
  }
  return font.replace(ancora, `${linia}\n${ancora}`);
}

// --- Endavant ---------------------------------------------------------------

const options = readOptions(Bun.argv.slice(2));
const base = join(Root, "src", "routes", options.dir);

if (await Bun.file(join(base, `${options.dir}.routes.ts`)).exists()) {
  console.error(`\n[nou-recurs] «${options.dir}» ja existeix. No toco res.\n`);
  process.exit(1);
}

const existents = new Set(
  (await readdir(join(Root, "src", "routes"), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);
if (existents.has(options.dir)) {
  console.error(`\n[nou-recurs] el directori «${options.dir}» ja hi es pero esta a mitges.\n`);
  process.exit(1);
}

await mkdir(base, { recursive: true });
await Bun.write(join(base, `${options.dir}.routes.ts`), fileRoutes(options));
await Bun.write(join(base, `${options.dir}.page.ts`), filePage(options));
await Bun.write(join(base, `${options.dir}.fragment.ts`), fileFragment(options));
await Bun.write(join(base, `${options.dir}.schema.ts`), fileSchema(options));

const indexPath = join(Root, "src", "routes", "index.ts");
await Bun.write(indexPath, registraRuta(await Bun.file(indexPath).text(), options));

const contractePath = join(Root, "tests", "contracte.test.ts");
await Bun.write(
  contractePath,
  registraContracte(await Bun.file(contractePath).text(), options),
);

// El format el posa el Prettier, no jo: aixi les plantilles no han de ser
// perfectes d'entrada i no hi ha dues opinions sobre com se sagna aixo.
//
// I la taula de recursos de l'`AGENTS.md` es torna a generar aqui mateix. Un
// recurs nou la canvia, i deixar-la per fer voldria dir que la bastida surt
// amb el `bun run ok` vermell —que es exactament el que aixo ha d'evitar.
for (const ordre of [
  ["bun", "run", "format"],
  ["bun", "run", "docs"],
]) {
  await Bun.spawn(ordre, { stdout: "ignore", stderr: "ignore" }).exited;
}

const url = options.admin ? `/${options.ruta}` : `/e/<espai>/${options.ruta}`;
console.log(`
[nou-recurs] fet. «${options.dir}» ja es dibuixa a ${url}.

  src/routes/${options.dir}/${options.dir}.routes.ts     rutes i guardes
  src/routes/${options.dir}/${options.dir}.page.ts       la pagina sencera
  src/routes/${options.dir}/${options.dir}.fragment.ts   els fragments d'HTMX
  src/routes/${options.dir}/${options.dir}.schema.ts     els esquemes de Zod

  src/routes/index.ts        hi queda registrat
  tests/contracte.test.ts    hi queda a la taula de pagines

Ara:
  1. Fes el servei a src/services/${options.dir}.ts i canvia-hi \`llista()\`.
  2. Comprova-ho amb \`bun run ok\`.

Per veure un recurs fet del tot: src/routes/tags/ (llista i detall) i
src/routes/categories/ (mutacions amb intercanvi fora de banda).
`);
