/**
 * Cleaning of bank concepts to get the merchant's name.
 *
 * Santander's concepts arrive with a lot of noise: operation type, card
 * digits, dates, town and internal references. This reduces them to a stable
 * name that serves as the key of the merchant memory
 * (`normalizeDescription`).
 *
 * A translation of `backend/app/services/normalization.py`. Most cases have
 * to give the same result as the Python (see
 * `tests/fixtures/normalitzacio.json`), but the old decision to treat
 * `COMISION` / `CAJERO` anywhere in the concept as a special bucket, or to
 * recycle the raw prefix when no token is left, is **not taken as correct**.
 * Those transactions have to be reassigned with `reassignNormalization`.
 *
 * **`normalizeDescription` is never changed lightly**: the recorded Python
 * output is compared against it in `tests/unitat/normalitzacio.test.ts`, and
 * changing it would regroup every `merchants.normalized_name` that already
 * exists.
 */

/** Detects the type before removing any prefix (over the bank's raw text). */
export type OperationType = "targeta" | "transferencia" | "bizum" | "rebut" | "altres";

export const OPERATION_TYPES = [
  "targeta",
  "transferencia",
  "bizum",
  "rebut",
  "altres",
] as const satisfies readonly OperationType[];

/**
 * The operation type decides where the counterparty goes
 * (`services/contraparts.ts`): only `transferencia` makes an actor. A Bizum,
 * even though it is also a transfer between people, stays a merchant: the
 * account holder decided so expressly (many Bizum purchases are to a
 * business, not to a person).
 */
export function detectOperationType(text: string): OperationType {
  const t = text.trim();
  if (!t) return "altres";

  if (
    /^(?:COMPRA|PAGO\s+(?:MOVIL|CON\s+MOVIL|TARJETA|EN)\b)/i.test(t) ||
    /\bTARJ(?:ETA)?\.?\b/i.test(t)
  ) {
    return "targeta";
  }
  if (/^BIZUM\b|^ENVIO\s+BIZUM\b/i.test(t)) return "bizum";
  if (/^TRANSFERENCIA\b|^TRANSF\b/i.test(t)) return "transferencia";
  if (/^(?:RECIBO|ADEUDO)\b/i.test(t)) return "rebut";
  return "altres";
}

/** Prefixes that describe the operation type and not the merchant. */
const PREFIX_PATTERNS: RegExp[] = [
  /^COMPRA\s+(?:CON\s+)?TARJ(?:ETA)?\.?\s*(?:DE\s+CREDITO|DE\s+DEBITO)?\s*/,
  /^PAGO\s+(?:MOVIL|CON\s+MOVIL|TARJETA|EN)\s*(?:EN\s+)?/,
  /^COMPRA\s+EN\s+/,
  // `\b\s*` (not `\s+`) because a concept that only says «COMPRA» must not
  // be left as the merchant name.
  /^COMPRA\b\s*/,
  /^ADEUDO\s+(?:POR\s+)?DOMICILIACION(?:\s+DE)?\s*/,
  /^ADEUDO\b\s*/,
  /^RECIBO\b(?:\s+(?:DE\s+)?)?/,
  /^TRANSFERENCIA\b(?:\s+(?:IMMEDIATA|URGENTE|ORDINARIA))*(?:\s+(?:RECIBIDA\s+)?(?:DE|A|A\s+FAVOR\s+DE|EMITIDA\s+A)?)?\s*/,
  /^TRANSF\.?\b(?:\s+(?:DE|A)?)?\s*/,
  /^BIZUM\b(?:\s+(?:DE|A|RECIBIDO\s+DE|ENVIADO\s+A)?)?\s*/,
  /^ENVIO\s+BIZUM\b(?:\s+A?)?\s*/,
  /^TRASPASO\b(?:\s+(?:DE|A)?)?\s*/,
  /^INGRESO\b(?:\s+(?:DE|EN\s+EFECTIVO|POR)?)?\s*/,
  /^NOMINA\b(?:\s+(?:DE|MES)?)?\s*/,
  /^PENSION\b(?:\s+(?:DE)?)?\s*/,
  /^REINTEGRO\b(?:\s+(?:EN\s+)?(?:CAJERO|OFICINA)?)?\s*/,
  /^DISPOSICION\s+(?:DE\s+)?EFECTIVO\b\s*/,
  /^COMISION\b(?:\s+(?:DE\s+)?)?/,
  /^LIQUIDACION\b(?:\s+(?:DE\s+)?)?/,
  /^PAGO\s+RECIBO\b\s*/,
  /^DEVOLUCION\b(?:\s+(?:DE\s+)?)?/,
  /^ABONO\b(?:\s+(?:DE\s+)?)?/,
  /^CARGO\b(?:\s+(?:DE\s+)?)?/,
];

/** Noise that can appear at any position in the concept. */
const NOISE_PATTERNS: [RegExp, string][] = [
  // Commission line Santander adds to purchases (it is not the concept).
  [/\bCOMISION\s+\d+[.,]\d{2}\b/gi, " "],
  // Full card at the end: «TARJETA 5489010385484017»
  [/\bTARJETA\s+\d{10,19}\b/gi, " "],
  // Masked card numbers: 5402XXXXXXXX1234, 1234******5678
  [/\b\d{2,6}[X*]{3,}\d{2,6}\b/gi, " "],
  [/\b[X*]{4,}\d{2,6}\b/gi, " "],
  // Dates and times
  [/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " "],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " "],
  // Long references and identifiers
  [/\b[A-Z]{0,3}\d{8,}\b/g, " "],
  // Mixed codes (letter+digit) like «P45ED4AF0B» from Spotify / payment gateways.
  [/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/g, " "],
  [/\bREF\.?\s*[:-]?\s*\w*/gi, " "],
  [/\bMANDATO\s*[:-]?\s*\w+/gi, " "],
  [/\bCONCEPTO\s*[:-]?/gi, " "],
  // Spanish NIF/CIF
  [/\b[A-Z]\d{7}[A-Z0-9]\b/g, " "],
  [/\b\d{8}[A-Z]\b/g, " "],
  // IBAN
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, " "],
  // Leftover punctuation and separators
  [/[·|;]+/g, " "],
  [/\s*[-_]{2,}\s*/g, " "],
];

/** From these words on, the rest of the concept is an internal reference. */
const TRUNCATE_PATTERNS: RegExp[] = [
  /\bCONCEPTO\b/i,
  /\bREF\.?\b/i,
  /\bMANDATO\b/i,
  /\bN\.?\s?ORDEN\b/i,
];

/**
 * Operations that have no merchant: a fixed, recognizable name.
 *
 * Only at the **start** of the concept. A purchase with «COMISION 0,00» at
 * the end (Santander) is not a bank fee; «CAJERO» in the middle of a purchase
 * is not a withdrawal either.
 */
const SPECIAL_PATTERNS: [RegExp, string][] = [
  [/^(?:REINTEGRO|DISPOSICION\s+DE\s+EFECTIVO)\b/, "REINTEGRO EFECTIU"],
  [/^COMISION\b/, "COMISSIO BANCARIA"],
  [/^TRASPASO\b/, "TRASPAS ENTRE COMPTES"],
];

/** Prepositions left dangling at the front after removing the prefix. */
const LEADING_STOPWORDS = new Set(["EN", "A", "DE", "DEL", "LA", "EL", "POR", "PARA", "FAVOR"]);

/** Months show up in payslips and direct debits and identify nothing. */
const MONTHS = new Set([
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
  "GENER",
  "FEBRER",
  "MARC",
  "MAIG",
  "JUNY",
  "JULIOL",
  "AGOST",
  "SETEMBRE",
  "NOVEMBRE",
  "DESEMBRE",
]);

/** Company suffixes left in capitals even when they are long. */
const COMPANY_SUFFIXES = new Set([
  "SA",
  "SL",
  "SLU",
  "SAU",
  "SARL",
  "SCP",
  "SCCL",
  "SAS",
  "BV",
  "GMBH",
  "LTD",
]);

/** Linking words that go in lower case inside a name. */
const CONNECTORS = new Set([
  "DE",
  "DEL",
  "DELS",
  "LA",
  "LES",
  "EL",
  "ELS",
  "I",
  "Y",
  "D'",
  "DA",
  "DO",
  "EN",
]);

/** Short words that are real words, not acronyms: «Bar», not «BAR». */
const SHORT_WORDS = new Set([
  "BAR",
  "CAL",
  "CAN",
  "MAS",
  "MAR",
  "SOL",
  "VIA",
  "PAN",
  "SUD",
  "RIU",
  "CASA",
]);

/** Trailing words that are usually the town or terminal data. */
const TRAILING_NOISE = new Set([
  "ES",
  "ESP",
  "ESPANA",
  "TARJ",
  "TARJETA",
  "COMERCIO",
  "TERMINAL",
  "OFICINA",
  "SUCURSAL",
]);

export function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

/** Equivalent of Python's `str.isdigit()` for the cases that reach us. */
const esNumero = (token: string): boolean => /^\d+$/.test(token);

/**
 * Equivalent of Python's `str.isupper()`: true if every cased character is
 * upper case **and there is at least one**. «4B» is true; «123» is not.
 */
function esMajuscules(word: string): boolean {
  if (!/[a-zA-Z]/.test(word)) return false;
  return word === word.toUpperCase();
}

/** Equivalent of `str.capitalize()`: first letter up, the rest down. */
function capitalitza(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Strips the given characters from both ends, like `strip(" .")`. */
function retallaExtrems(text: string, chars: string): string {
  let inici = 0;
  let fi = text.length;
  while (inici < fi && chars.includes(text[inici] as string)) inici += 1;
  while (fi > inici && chars.includes(text[fi - 1] as string)) fi -= 1;
  return text.slice(inici, fi);
}

/**
 * Turns the upper-case key into a readable name.
 */
export function displayName(normalized: string): string {
  const words: string[] = [];
  const parts = normalized.split(/\s+/).filter(Boolean);

  for (const [position, word] of parts.entries()) {
    if (position > 0 && CONNECTORS.has(word)) {
      // «Comunitat de Propietaris», not «Comunitat DE Propietaris».
      words.push(word.toLowerCase());
    } else if (
      COMPANY_SUFFIXES.has(word) ||
      (word.length <= 3 && esMajuscules(word) && !esNumero(word) && !SHORT_WORDS.has(word))
    ) {
      // Acronyms and short codes like SA, SL or 4B are left as they are.
      words.push(word);
    } else {
      words.push(capitalitza(word));
    }
  }

  return words.join(" ");
}

/**
 * Returns `[normalized key, display name]`.
 *
 * The key is upper case and without accents, fit for grouping. The display
 * name is the same text with a readable capitalization.
 */
export function normalizeDescription(description: string, counterparty = ""): [string, string] {
  // If the bank already gives the counterparty, it is far more reliable than the free concept.
  const source = counterparty.trim() || description.trim();
  if (!source) return ["", ""];

  let text = stripAccents(source).toUpperCase();

  // Operations with no merchant are resolved first of all (only at the start).
  if (!counterparty.trim()) {
    for (const [pattern, label] of SPECIAL_PATTERNS) {
      if (pattern.test(text)) {
        return [label, displayName(label)];
      }
    }
  }

  let haTretPrefix = false;
  for (const pattern of PREFIX_PATTERNS) {
    const replaced = text.replace(pattern, "");
    if (replaced !== text) {
      text = replaced;
      // With a known prefix, what comes after a comma is usually the town.
      text = text.split(",")[0] ?? "";
      haTretPrefix = true;
      break;
    }
  }

  for (const pattern of TRUNCATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) text = text.slice(0, match.index);
  }

  for (const [pattern, replacement] of NOISE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/[^A-Z0-9&'.\s]/g, " ");
  const tokens = text.split(/\s+/).filter(Boolean);

  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1] as string;
    if (TRAILING_NOISE.has(last) || esNumero(last)) tokens.pop();
    else break;
  }
  while (tokens.length > 0) {
    const first = tokens[0] as string;
    if (esNumero(first) || LEADING_STOPWORDS.has(first) || MONTHS.has(first)) tokens.shift();
    else break;
  }

  // Very long names are trimmed: the tail is usually an internal reference.
  const normalized = retallaExtrems(tokens.slice(0, 6).join(" ").slice(0, 200), " .");
  if (!normalized) {
    // If there was only the operation prefix, we do not recycle it as a
    // merchant name: every empty «PAGO MOVIL EN» would end up in the same place.
    if (haTretPrefix) return ["", ""];
    // With no prefix: better some key than leaving the transaction nameless.
    const fallback = stripAccents(source)
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
    return [fallback, displayName(fallback)];
  }

  return [normalized, displayName(normalized)];
}
