/**
 * Scaffolds a new resource.
 *
 *   bun run nou-recurs projects
 *   bun run nou-recurs projects --ruta projectes --titol "Projectes"
 *   bun run nou-recurs backups --admin
 *
 * **Why it exists.** Adding a resource means six things at once: the four
 * files of the rule, the registration in `src/routes/index.ts` and the entry
 * in the table of `tests/contracte.test.ts`. And it means getting the depth of
 * the relative imports right (`../../`), which is exactly the kind of thing
 * that goes wrong one time in three.
 *
 * Written out like that, it is a consistency job across files. Done with one
 * command, it is filling in the blanks of files that already compile. The
 * second job is far easier to get right, and not only for a tired person.
 *
 * What comes out **passes `bun run ok` as it stands**: scaffolding that does
 * not compile is worse than none, because the first thing whoever uses it does
 * is wonder whether they broke it.
 *
 * The code it writes is English, as the rest of the repository is. The text
 * that reaches a screen and the URL segment stay Catalan: that is the
 * boundary `AGENTS.md` declares, and scaffolding that crossed it would teach
 * the opposite of the rule.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const Root = resolve(import.meta.dir, "..");

interface Options {
  /** The directory under `src/routes/`, English and plural. */
  dir: string;
  /** The URL segment, Catalan, because URLs are product surface. */
  segment: string;
  /** The heading of the page, Catalan, because it is shown. */
  title: string;
  /** An installation-administration resource, outside any workspace. */
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
  const positional: string[] = [];
  const named = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "admin") {
      named.set("admin", "si");
      continue;
    }
    const value = argv[++i];
    if (value === undefined) help(`A --${key} li falta el valor.`);
    named.set(key, value);
  }

  const dir = positional[0];
  if (dir === undefined) help("Digues com s'ha de dir el recurs.");
  if (!/^[a-z][a-z0-9-]*$/.test(dir)) {
    help(`«${dir}» no serveix de nom: minuscules, xifres i guions, i comença per lletra.`);
  }

  const segment = named.get("ruta") ?? dir;
  const title = named.get("titol") ?? segment.charAt(0).toUpperCase() + segment.slice(1);
  return { dir, segment, title, admin: named.has("admin") };
}

/** `projects` → `Projects`; `bank-connections` → `BankConnections`. */
function inPascal(name: string): string {
  return name
    .split("-")
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join("");
}

/** `bank-connections` → `bankConnections`. */
function inCamel(name: string): string {
  const pascal = inPascal(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// --- The four files ---------------------------------------------------------

function fileSchema(o: Options): string {
  return `/**
 * Schemas of the ${o.dir} resource.
 *
 * One schema per resource, and **the Drizzle table is the source of truth**:
 * when you validate a row, derive it with \`drizzle-zod\` and refine it, not
 * the other way round.
 */

import { z } from "zod/v4";

export const PER_PAGE = 50;

/**
 * The filters and the pagination live in the query string, not in any client
 * variable: that way they can be linked to and the back button works.
 *
 * The keys are the wire format, so they stay Catalan: renaming \`pagina\`
 * would break every link and bookmark that already exists.
 */
export const ${inCamel(o.dir)}QuerySchema = z.object({
  pagina: z.coerce.number().int().min(0).default(0),
});

export type ${inPascal(o.dir)}Query = z.infer<typeof ${inCamel(o.dir)}QuerySchema>;

export function ${inCamel(o.dir)}ToQuery(q: ${inPascal(o.dir)}Query): string {
  if (q.pagina <= 0) return "";
  return \`?pagina=\${q.pagina}\`;
}
`;
}

function fileFragment(o: Options): string {
  return `/**
 * Fragments of the ${o.dir} resource.
 *
 * Everything HTMX can ask for separately lives here. Mutations return the
 * piece that changed; if they also change something outside it, that goes
 * beside it with \`withOob()\` and its target has to be in \`src/lib/oob.ts\`.
 *
 * For a finished one: \`src/routes/tags/\` (list and detail) and
 * \`src/routes/categories/\` (mutations with an out-of-band swap).
 */

import { html } from "hono/html";

import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";

export interface ${inPascal(o.dir)}View {
  id: number;
  name: string;
}

export function List({
  code,
  items,
}: {
  code: string;
  items: ${inPascal(o.dir)}View[];
}): Html {
  return html\`<div id="llista-${o.segment}">
    \${DataTable({
      columnes: html\`<th>Nom</th>\` as Html,
      rows: items.map(
        (item) => html\`<tr id="${o.segment}-\${item.id}">
          <td>\${item.name}</td>
        </tr>\` as Html,
      ),
      // The rows and the empty state go together on purpose: see components/vista.ts.
      empty: "Encara no hi ha res.",
    })}
    <!-- \${code} is the workspace code; use it in the HTMX URLs. -->
  </div>\` as Html;
}
`;
}

function filePage(o: Options): string {
  return `/**
 * Page of the ${o.dir} resource.
 *
 * \`GET <base>\` **always** returns a whole page. The shell (sidebar,
 * workspace picker and counters) is put there by the caller, with
 * \`workspacePage()\`.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import { List, type ${inPascal(o.dir)}View } from "./${o.dir}.fragment.ts";

export function ${inPascal(o.dir)}Page({
  code,
  items,
}: {
  code: string;
  items: ${inPascal(o.dir)}View[];
}): Html {
  return html\`
    <header class="capçalera">
      <h1>${o.title}</h1>
    </header>

    \${List({ code, items })}
  \` as Html;
}
`;
}

function fileRoutes(o: Options): string {
  const pascal = inPascal(o.dir);
  const camel = inCamel(o.dir);

  const header = o.admin
    ? `/**
 * Routes of the ${o.dir} resource. Installation administrators only.
 *
 * GET /${o.segment} → the whole page.
 * GET /${o.segment}/fragment/llista → the list fragment.
 */`
    : `/**
 * Routes of the ${o.dir} resource.
 *
 * GET <base> → the whole page.
 * GET <base>/fragment/llista → the list fragment.
 *
 * The routes are thin: read parameters, authorize, call the service and draw.
 * The logic goes in \`src/services/\`.
 */`;

  const imports = o.admin
    ? `import { Hono } from "hono";

import { Layout } from "../../components/layout.ts";
import { fragment, page, pushUrl } from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { myWorkspaces } from "../../middleware/workspace.ts";
import { List, type ${pascal}View } from "./${o.dir}.fragment.ts";
import { ${pascal}Page } from "./${o.dir}.page.ts";
import { ${camel}QuerySchema, ${camel}ToQuery } from "./${o.dir}.schema.ts";`
    : `import { Hono } from "hono";

import { workspacePage } from "../../components/workspace-page.ts";
import { fragment, page, pushUrl } from "../../lib/http.ts";
import { currentWorkspace } from "../../middleware/workspace.ts";
import { List, type ${pascal}View } from "./${o.dir}.fragment.ts";
import { ${pascal}Page } from "./${o.dir}.page.ts";
import { ${camel}QuerySchema, ${camel}ToQuery } from "./${o.dir}.schema.ts";`;

  const body = o.admin
    ? `
/** There is no service yet: it returns an empty list. Replace this. */
async function list(): Promise<${pascal}View[]> {
  return [];
}

${camel}Routes.get("/", async (c) => {
  const user = currentUser(c);
  const items = await list();

  return page(
    c,
    Layout({
      title: "${o.title}",
      user,
      csrfToken: c.get("csrfToken") ?? "",
      path: c.req.path,
      workspaces: await myWorkspaces(user.id),
      children: ${pascal}Page({ code: "", items }),
    }),
  );
});

${camel}Routes.get("/fragment/llista", async (c) => {
  const filters = ${camel}QuerySchema.parse(c.req.query());
  const items = await list();

  // The fragment route pushes **the page's URL**, not its own.
  pushUrl(c, \`/${o.segment}\${${camel}ToQuery(filters)}\`);

  return fragment(c, List({ code: "", items }));
});
`
    : `
/** There is no service yet: it returns an empty list. Replace this. */
async function list(ledgerId: number): Promise<${pascal}View[]> {
  // Every query has to filter by workspace, always. See AGENTS.md.
  void ledgerId;
  return [];
}

${camel}Routes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const items = await list(workspace.id);

  return page(
    c,
    await workspacePage(c, "${o.title}", ${pascal}Page({ code: workspace.code, items })),
  );
});

${camel}Routes.get("/fragment/llista", async (c) => {
  const workspace = currentWorkspace(c);
  const filters = ${camel}QuerySchema.parse(c.req.query());
  const items = await list(workspace.id);

  // The fragment route pushes **the page's URL**, not its own.
  pushUrl(c, \`/e/\${workspace.code}/${o.segment}\${${camel}ToQuery(filters)}\`);

  return fragment(c, List({ code: workspace.code, items }));
});
`;

  return `${header}

${imports}

export const ${camel}Routes = new Hono();
${body}`;
}

// --- The two files that were already there ----------------------------------

function registerRoute(source: string, o: Options): string {
  const camel = inCamel(o.dir);
  const newImport = `import { ${camel}Routes } from "./${o.dir}/${o.dir}.routes.ts";`;

  if (source.includes(newImport)) return source;

  const firstImport = source.indexOf("import { alertsRoutes }");
  if (firstImport === -1)
    throw new Error("No trobo on posar l'importacio a src/routes/index.ts");
  let text = source.slice(0, firstImport) + newImport + "\n" + source.slice(firstImport);

  if (o.admin) {
    const anchor = `  app.route("/e/:codi", workspace);`;
    const block =
      `  const ${camel} = new Hono();\n` +
      `  ${camel}.use("*", requireUser);\n` +
      `  ${camel}.use("*", requireAdmin);\n` +
      `  ${camel}.route("/", ${camel}Routes);\n` +
      `  app.route("/${o.segment}", ${camel});\n\n`;
    if (!text.includes(anchor))
      throw new Error("No trobo l'ancora de registre a src/routes/index.ts");
    text = text.replace(anchor, block + anchor);
  } else {
    const anchor = `  // Analytics carries the workspace root, the reports and the forecast.`;
    if (!text.includes(anchor))
      throw new Error("No trobo l'ancora de registre a src/routes/index.ts");
    text = text.replace(
      anchor,
      `  workspace.route("/${o.segment}", ${camel}Routes);\n\n${anchor}`,
    );
  }

  return text;
}

function registerContract(source: string, o: Options): string {
  if (source.includes(`resource: "${o.dir}"`)) return source;

  const url = o.admin ? `/${o.segment}` : `/e/personal/${o.segment}`;
  const line = `  { resource: "${o.dir}", url: "${url}", what: "${o.title.toLowerCase()}" },`;
  const anchor = `];\n\n/**\n * The resources that have no page`;

  if (!source.includes(anchor)) {
    throw new Error("No trobo la taula Pages a tests/contracte.test.ts");
  }
  return source.replace(anchor, `${line}\n${anchor}`);
}

// --- Off we go --------------------------------------------------------------

const options = readOptions(Bun.argv.slice(2));
const base = join(Root, "src", "routes", options.dir);

if (await Bun.file(join(base, `${options.dir}.routes.ts`)).exists()) {
  console.error(`\n[nou-recurs] «${options.dir}» ja existeix. No toco res.\n`);
  process.exit(1);
}

const existing = new Set(
  (await readdir(join(Root, "src", "routes"), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);
if (existing.has(options.dir)) {
  console.error(`\n[nou-recurs] el directori «${options.dir}» ja hi es pero esta a mitges.\n`);
  process.exit(1);
}

await mkdir(base, { recursive: true });
await Bun.write(join(base, `${options.dir}.routes.ts`), fileRoutes(options));
await Bun.write(join(base, `${options.dir}.page.ts`), filePage(options));
await Bun.write(join(base, `${options.dir}.fragment.ts`), fileFragment(options));
await Bun.write(join(base, `${options.dir}.schema.ts`), fileSchema(options));

const indexPath = join(Root, "src", "routes", "index.ts");
await Bun.write(indexPath, registerRoute(await Bun.file(indexPath).text(), options));

const contractPath = join(Root, "tests", "contracte.test.ts");
await Bun.write(contractPath, registerContract(await Bun.file(contractPath).text(), options));

// Prettier does the formatting, not me: that way the templates need not be
// perfect from the start and there are no two opinions about how this indents.
//
// And the resource table of the docs is regenerated right here. A new resource
// changes it, and leaving that undone would mean the scaffolding comes out
// with `bun run ok` red —which is exactly what this is meant to prevent.
for (const command of [
  ["bun", "run", "format"],
  ["bun", "run", "docs"],
]) {
  await Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited;
}

const url = options.admin ? `/${options.segment}` : `/e/<espai>/${options.segment}`;
console.log(`
[nou-recurs] fet. «${options.dir}» ja es dibuixa a ${url}.

  src/routes/${options.dir}/${options.dir}.routes.ts     rutes i guardes
  src/routes/${options.dir}/${options.dir}.page.ts       la pagina sencera
  src/routes/${options.dir}/${options.dir}.fragment.ts   els fragments d'HTMX
  src/routes/${options.dir}/${options.dir}.schema.ts     els esquemes de Zod

  src/routes/index.ts        hi queda registrat
  tests/contracte.test.ts    hi queda a la taula de pagines

Ara:
  1. Fes el servei a src/services/${options.dir}.ts i canvia-hi \`list()\`.
  2. Comprova-ho amb \`bun run ok\`.

Per veure un recurs fet del tot: src/routes/tags/ (llista i detall) i
src/routes/categories/ (mutacions amb intercanvi fora de banda).
`);
