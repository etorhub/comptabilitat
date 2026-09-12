/**
 * Els objectius dels intercanvis fora de banda.
 *
 * **Aquest fitxer es la font de veritat, i la taula de l'`AGENTS.md` en surt.**
 * `bun run docs` la torna a escriure i `bun run docs:check` (dins de `bun run
 * check`) fa fallar el CI si no hi encaixa. Aixi la documentacio no pot quedar
 * enrere: no es que algu s'hagi de recordar d'actualitzar-la, es que no existeix
 * per separat.
 *
 * Feia falta. La taula de l'`AGENTS.md` en llistava **tres** quan el codi ja en
 * dibuixava **tretze**, i aixo despres d'un commit (`a3a9457`) dedicat
 * expressament a reconciliar el document amb el codi. Una llista escrita a ma
 * al costat del codi torna a separar-se'n; l'unica manera que no passi es que
 * no sigui a ma.
 *
 * **I el registre es de debo, no decoratiu.** Els components demanen els seus
 * atributs a `atributsOob()`, que nomes accepta claus d'aqui: un objectiu nou
 * que no s'hi registri no compila. Un registre que ningu no importa es
 * exactament tan fragil com la taula que substitueix.
 */

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Com s'intercanvia un objectiu.
 *
 * Gairebe tots son `outerHTML`: arriba el node sencer i substitueix el que hi
 * havia. El `#toast` no, i el motiu es a `lib/http.ts`: si es reemplaces el
 * node sencer, el de recanvi hauria de dur l'`aria-live`, i el navegador nomes
 * anuncia una regio viva que ja existia quan s'hi ha posat el text.
 */
export type OobMode = "outerHTML" | "innerHTML";

export interface OobTarget {
  /** Qui el dibuixa. */
  amo: string;
  /** Quan canvia. */
  quan: string;
  mode: OobMode;
}

export const OOB_TARGETS = {
  toast: {
    amo: "lib/http.ts",
    quan: "qualsevol error o confirmacio",
    mode: "innerHTML",
  },
  "comptador-revisio": {
    amo: "components/layout.ts",
    quan: "es classifica un moviment",
    mode: "outerHTML",
  },
  "comptador-avisos": {
    amo: "components/layout.ts",
    quan: "es llegeix o es descarta un avis",
    mode: "outerHTML",
  },
  "arbre-categories": {
    amo: "routes/categories",
    quan: "es crea, es canvia o s'esborra una categoria",
    mode: "outerHTML",
  },
  "filtre-targetes": {
    amo: "routes/transactions",
    quan: "canvien les targetes conegudes de l'espai",
    mode: "outerHTML",
  },
  "taula-recurrents-propostes": {
    amo: "routes/recurring",
    quan: "es confirma o es descarta una proposta",
    mode: "outerHTML",
  },
  "taula-recurrents-actives": {
    amo: "routes/recurring",
    quan: "es confirma, es canvia o es descarta una serie",
    mode: "outerHTML",
  },
  "llista-connexions": {
    amo: "routes/connections",
    quan: "es connecta, es mou o s'esborra un compte",
    mode: "outerHTML",
  },
  "llista-usuaris": {
    amo: "routes/users",
    quan: "es crea, es canvia o s'esborra un usuari",
    mode: "outerHTML",
  },
  "llista-feines": {
    amo: "routes/jobs",
    quan: "canvia la configuracio d'una feina",
    mode: "outerHTML",
  },
  "historial-feines": {
    amo: "routes/jobs",
    quan: "acaba una execucio",
    mode: "outerHTML",
  },
  "en-curs": {
    amo: "routes/jobs",
    quan: "arrenca o acaba una feina",
    mode: "outerHTML",
  },
  "agenda-salut": {
    amo: "routes/jobs",
    quan: "canvia l'estat del planificador",
    mode: "outerHTML",
  },
} as const satisfies Record<string, OobTarget>;

export type OobId = keyof typeof OOB_TARGETS;

/**
 * L'`id` d'un objectiu i, si toca, el seu `hx-swap-oob`.
 *
 * Substitueix l'`id="..."` escrit a ma mes el
 * `${oob ? raw('hx-swap-oob="true"') : ""}` que hi havia repetit a onze llocs.
 * El tipus de `id` es el que lliga el registre amb el codi: un objectiu que no
 * hi sigui no compila.
 */
export function oobAttributes(id: OobId, oob = false): HtmlEscapedString {
  return raw(`id="${id}"${oob ? ' hx-swap-oob="true"' : ""}`) as HtmlEscapedString;
}

/**
 * L'atribut d'un embolcall que canvia **el contingut** d'un objectiu.
 *
 * Nomes per als de mode `innerHTML`: el node que es dibuixa no es l'objectiu,
 * sino una capsa que duu el contingut nou cap a ell.
 */
export function oobWrapper(id: OobId): HtmlEscapedString {
  return raw(`hx-swap-oob="innerHTML:#${id}"`) as HtmlEscapedString;
}
