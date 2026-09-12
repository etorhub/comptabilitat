/**
 * The stable identifiers of the categories.
 *
 * A translation of the part of `backend/app/services/seed.py` that code
 * everywhere depends on. The three slugs below **cannot be changed**: there
 * is logic that looks them up by name.
 */

/** Where the transactions nobody has matched end up. */
export const SLUG_UNCATEGORIZED = "altres-despeses-sense-classificar";
/** Transfers between two accounts of the same workspace. */
export const SLUG_INTERNAL_TRANSFER = "traspassos-traspas-entre-comptes-propis";
/** Money taken out of a cash machine. */
export const SLUG_CASH_WITHDRAWAL = "altres-despeses-efectiu-retirat";

/**
 * System categories that cannot be deleted under any circumstances: there is
 * code that counts on them (the classification and the transfer pairing).
 */
export const PROTECTED_SLUGS: readonly string[] = [SLUG_UNCATEGORIZED, SLUG_INTERNAL_TRANSFER];

/**
 * Same result as the Python's `slugify`: it normalizes in NFKD, throws away
 * anything that is not ASCII, and joins what is left of the alphanumerics with hyphens.
 *
 * It has to match exactly, because the slugs above are literals already stored.
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
