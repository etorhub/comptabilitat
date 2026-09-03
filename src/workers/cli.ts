/**
 * Llançar les feines a ma.
 *
 *   bun run src/workers/cli.ts sync [--connexio 1] [--dies 30]
 *   bun run src/workers/cli.ts classify
 *   bun run src/workers/cli.ts analyze
 *   bun run src/workers/cli.ts maintenance
 *
 * Equival al `python -m app.cli sync|classify|analyze` d'abans.
 */

import { closeDb } from "../db/client.ts";
import { feinaAnalisi } from "./jobs/analyze.ts";
import { feinaClassificacio } from "./jobs/classify.ts";
import { feinaManteniment } from "./jobs/maintenance.ts";
import { feinaSincronitzacio } from "./jobs/sync.ts";

function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const enter = (nom: string): number | null => {
  const valor = Number.parseInt(arg(nom) ?? "", 10);
  return Number.isNaN(valor) ? null : valor;
};

const feines: Record<string, () => Promise<string>> = {
  sync: () =>
    feinaSincronitzacio({ connectionId: enter("connexio"), daysBack: enter("dies") }),
  classify: feinaClassificacio,
  analyze: feinaAnalisi,
  maintenance: feinaManteniment,
};

const ordre = process.argv[2];
const feina = ordre === undefined ? undefined : feines[ordre];

if (feina === undefined) {
  console.error(`Feines: ${Object.keys(feines).join(", ")}`);
  process.exit(1);
}

try {
  console.log(await feina());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
