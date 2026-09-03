/**
 * Els identificadors estables de les categories.
 *
 * Traduccio de la part de `backend/app/services/seed.py` de la qual depen codi
 * d'arreu. Els tres pendents de sota **no es poden canviar**: hi ha logica que
 * els busca pel nom.
 */

/** On van a parar els moviments que no ha encaixat ningu. */
export const SLUG_UNCATEGORIZED = "altres-despeses-sense-classificar";
/** Els traspassos entre dos comptes del mateix espai. */
export const SLUG_INTERNAL_TRANSFER = "traspassos-traspas-entre-comptes-propis";
/** Diners trets d'un caixer. */
export const SLUG_CASH_WITHDRAWAL = "altres-despeses-efectiu-retirat";

/**
 * Categories del sistema que no es poden esborrar de cap manera: hi ha codi
 * que hi compta (la classificacio i l'aparellament de traspassos).
 */
export const PROTECTED_SLUGS: readonly string[] = [SLUG_UNCATEGORIZED, SLUG_INTERNAL_TRANSFER];

/**
 * Mateix resultat que el `slugify` del Python: normalitza en NFKD, llença el
 * que no sigui ASCII, i uneix amb guions el que quedi d'alfanumeric.
 *
 * Ha de coincidir exactament, perque els pendents de dalt son literals que ja
 * hi ha desats a la base de dades.
 */
export function slugify(value: string): string {
  const ascii = value
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();

  return ascii
    .split("")
    .map((char) => (/[a-z0-9]/.test(char) ? char : " "))
    .join("")
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
}
