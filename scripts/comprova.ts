/**
 * Les comprovacions, una darrere l'altra, dient quina ha fallat.
 *
 * Abans aixo era una cadena de cinc `&&` dins del `package.json`. Quan petava,
 * el que sortia per pantalla era la sortida crua de l'eina que hagues fallat
 * —de vegades cent linies de `tsc`— sense res que digues **quina** de les cinc
 * era ni que calia fer. Qui ho sap ja no ho necessita; qui no ho sap es
 * exactament qui ho llegeix.
 *
 * Aqui cada passa duu el seu nom i com s'arregla, i al final es diu en una
 * linia. No hi ha cap magia: es la mateixa cadena, amb etiquetes.
 */

interface Passa {
  nom: string;
  ordre: string[];
  /** Que ha de fer qui la vegi vermella. */
  arregla: string;
}

const PASSES: Passa[] = [
  {
    nom: "tipus",
    ordre: ["bun", "run", "typecheck"],
    arregla: "Arregla els errors que diu el `tsc`. No hi posis `any` ni `!`.",
  },
  {
    nom: "estil",
    ordre: ["bun", "run", "lint"],
    arregla: "Arregla el que diu l'oxlint.",
  },
  {
    nom: "format",
    ordre: ["bun", "run", "format:check"],
    arregla: "Passa-hi `bun run format`. No cal tocar res a ma.",
  },
  {
    nom: "frontera",
    ordre: ["bun", "run", "frontera"],
    arregla: "`htmx-contract/` no pot importar res de l'aplicacio. Vegeu AGENTS.md.",
  },
  {
    nom: "documentacio",
    ordre: ["bun", "run", "docs:check"],
    arregla: "Passa-hi `bun run docs`. Les taules generades no s'editen a ma.",
  },
];

const fallides: Passa[] = [];

for (const passa of PASSES) {
  const proc = Bun.spawn(passa.ordre, { stdout: "inherit", stderr: "inherit" });
  const codi = await proc.exited;
  if (codi !== 0) fallides.push(passa);
}

if (fallides.length === 0) {
  console.log("\n[comprova] tot net.");
  process.exit(0);
}

console.error(`\n[comprova] ha fallat: ${fallides.map((f) => f.nom).join(", ")}\n`);
for (const passa of fallides) {
  console.error(`  ${passa.nom}: ${passa.arregla}`);
}
console.error("");
process.exit(1);
