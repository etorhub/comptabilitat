/**
 * Adreces versionades dels fitxers de `public/`.
 *
 * Els estàtics es serveixen amb `Cache-Control: immutable` d'un any. Sense
 * un `?v=` lligat al contingut, un desplegament deixaria CSS/JS vells al
 * navegador fins que caduqués la memòria cau. El resum canvia quan canvia
 * el fitxer; en desenvolupament, el `css:watch` es nota al refrescar la
 * pàgina sense reiniciar el servidor (la memòria cau local mira el mtime).
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "../../public");

interface Login {
  mtimeMs: number;
  summary: string;
}

const memoria = new Map<string, Login>();

/**
 * Fitxers que la plantilla pot demanar. Només aquests: la funció no és
 * un servidor d'estàtics genèric.
 */
export type StaticFile =
  "app.css" | "htmx.min.js" | "echarts.min.js" | "grafics.js" | "favicon.svg";

function summaryOf(name: StaticFile): string {
  const path = join(PUBLIC, name);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    // El fitxer pot no existir encara (p. ex. `app.css` abans de `bun run css`).
    // Retornem un marcador estable perquè la plantilla no peti.
    return "absent";
  }

  const cached = memoria.get(name);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.summary;
  }

  // Lectura síncrona: les plantilles de hono/html es dibuixen síncronament.
  const buffer = readFileSync(path);
  const summary = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  memoria.set(name, { mtimeMs, summary });
  return summary;
}

/** Adreça amb versió: `/app.css?v=a1b2c3d4`. */
export function staticHref(name: StaticFile): string {
  return `/${name}?v=${summaryOf(name)}`;
}
