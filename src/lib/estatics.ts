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

interface Entrada {
  mtimeMs: number;
  resum: string;
}

const memoria = new Map<string, Entrada>();

/**
 * Fitxers que la plantilla pot demanar. Només aquests: la funció no és
 * un servidor d'estàtics genèric.
 */
export type FitxerEstatic =
  | "app.css"
  | "htmx.min.js"
  | "echarts.min.js"
  | "grafics.js"
  | "favicon.svg";

function resumDe(nom: FitxerEstatic): string {
  const cami = join(PUBLIC, nom);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(cami).mtimeMs;
  } catch {
    // El fitxer pot no existir encara (p. ex. `app.css` abans de `bun run css`).
    // Retornem un marcador estable perquè la plantilla no peti.
    return "absent";
  }

  const cached = memoria.get(nom);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.resum;
  }

  // Lectura síncrona: les plantilles de hono/html es dibuixen síncronament.
  const buffer = readFileSync(cami);
  const resum = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  memoria.set(nom, { mtimeMs, resum });
  return resum;
}

/** Adreça amb versió: `/app.css?v=a1b2c3d4`. */
export function hrefEstatic(nom: FitxerEstatic): string {
  return `/${nom}?v=${resumDe(nom)}`;
}
