/**
 * Neteja dels conceptes bancaris per obtenir el nom del comerç.
 *
 * Els conceptes del Santander arriben amb molt de soroll: tipus d'operacio,
 * digits de la targeta, dates, poblacio i referencies internes. Aixo ho
 * redueix a un nom estable que serveix de clau de la memoria de comerços.
 *
 * Traduccio de `backend/app/services/normalization.py`. La majoria de casos
 * han de donar el mateix resultat que el Python (vegeu
 * `tests/fixtures/normalitzacio.json`), pero **no es dona per bona** la
 * decisio antiga de tractar `COMISION` / `CAJERO` a qualsevol lloc del
 * concepte com a cubell especial, ni de reciclar el prefix cru quan no
 * queda cap token. Aquells moviments s'han de reassignar amb
 * `reassignaNormalitzacio`.
 */

/** Prefixos que descriuen el tipus d'operacio i no el comerç. */
const PREFIX_PATTERNS: RegExp[] = [
  /^COMPRA\s+(?:CON\s+)?TARJ(?:ETA)?\.?\s*(?:DE\s+CREDITO|DE\s+DEBITO)?\s*/,
  /^PAGO\s+(?:MOVIL|CON\s+MOVIL|TARJETA|EN)\s*(?:EN\s+)?/,
  /^COMPRA\s+EN\s+/,
  // `\b\s*` (no `\s+`) perque un concepte que nomes diu «COMPRA» no
  // s'ha de quedar com a nom de comerç.
  /^COMPRA\b\s*/,
  /^ADEUDO\s+(?:POR\s+)?DOMICILIACION(?:\s+DE)?\s*/,
  /^ADEUDO\b\s*/,
  /^RECIBO\b(?:\s+(?:DE\s+)?)?/,
  /^TRANSFERENCIA\b(?:\s+(?:RECIBIDA\s+)?(?:DE|A|A\s+FAVOR\s+DE|EMITIDA\s+A)?)?\s*/,
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

/** Soroll que pot apareixer a qualsevol posicio del concepte. */
const NOISE_PATTERNS: [RegExp, string][] = [
  // Linia de comissio que el Santander afegeix a les compres (no es el concepte).
  [/\bCOMISION\s+\d+[.,]\d{2}\b/gi, " "],
  // Targeta completa al final: «TARJETA 5489010385484017»
  [/\bTARJETA\s+\d{10,19}\b/gi, " "],
  // Numeros de targeta emmascarats: 5402XXXXXXXX1234, 1234******5678
  [/\b\d{2,6}[X*]{3,}\d{2,6}\b/gi, " "],
  [/\b[X*]{4,}\d{2,6}\b/gi, " "],
  // Dates i hores
  [/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " "],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " "],
  // Referencies llargues i identificadors
  [/\b[A-Z]{0,3}\d{8,}\b/g, " "],
  // Codis mixtos (lletra+digit) tipus «P45ED4AF0B» de Spotify / passarel·les.
  [/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/g, " "],
  [/\bREF\.?\s*[:-]?\s*\w*/gi, " "],
  [/\bMANDATO\s*[:-]?\s*\w+/gi, " "],
  [/\bCONCEPTO\s*[:-]?/gi, " "],
  // NIF/CIF espanyols
  [/\b[A-Z]\d{7}[A-Z0-9]\b/g, " "],
  [/\b\d{8}[A-Z]\b/g, " "],
  // IBAN
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, " "],
  // Restes de puntuacio i separadors
  [/[·|;]+/g, " "],
  [/\s*[-_]{2,}\s*/g, " "],
];

/** A partir d'aquestes paraules, la resta del concepte es referencia interna. */
const TRUNCATE_PATTERNS: RegExp[] = [
  /\bCONCEPTO\b/i,
  /\bREF\.?\b/i,
  /\bMANDATO\b/i,
  /\bN\.?\s?ORDEN\b/i,
];

/**
 * Operacions que no tenen comerç: nom fix i reconeixible.
 *
 * Nomes a l'**inici** del concepte. Una compra amb «COMISION 0,00» al final
 * (Santander) no es una comissio bancaria; «CAJERO» al mig d'una compra
 * tampoc es un reintegrament.
 */
const SPECIAL_PATTERNS: [RegExp, string][] = [
  [/^(?:REINTEGRO|DISPOSICION\s+DE\s+EFECTIVO)\b/, "REINTEGRO EFECTIU"],
  [/^COMISION\b/, "COMISSIO BANCARIA"],
  [/^TRASPASO\b/, "TRASPAS ENTRE COMPTES"],
];

/** Preposicions que queden penjades al davant despres de treure el prefix. */
const LEADING_STOPWORDS = new Set(["EN", "A", "DE", "DEL", "LA", "EL", "POR", "PARA", "FAVOR"]);

/** Els mesos surten a nomines i rebuts i no identifiquen res. */
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

/** Sigles societaries que es deixen en majuscules encara que siguin llargues. */
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

/** Enllaços que dins d'un nom van en minuscula. */
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

/** Paraules curtes que son paraules de debò, no sigles: «Bar», no «BAR». */
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

/** Paraules finals que solen ser la poblacio o dades del terminal. */
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

/** Equivalent de `str.isdigit()` de Python per als casos que ens arriben. */
const esNumero = (token: string): boolean => /^\d+$/.test(token);

/**
 * Equivalent de `str.isupper()` de Python: cert si tots els carácters amb
 * caixa son majuscules **i n'hi ha com a minim un**. «4B» es cert; «123», no.
 */
function esMajuscules(word: string): boolean {
  if (!/[a-zA-Z]/.test(word)) return false;
  return word === word.toUpperCase();
}

/** Equivalent de `str.capitalize()`: la primera lletra amunt, la resta avall. */
function capitalitza(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Treu els carácters indicats dels dos extrems, com el `strip(" .")`. */
function retallaExtrems(text: string, chars: string): string {
  let inici = 0;
  let fi = text.length;
  while (inici < fi && chars.includes(text[inici] as string)) inici += 1;
  while (fi > inici && chars.includes(text[fi - 1] as string)) fi -= 1;
  return text.slice(inici, fi);
}

/**
 * Converteix la clau en majuscules en un nom llegible.
 */
export function displayName(normalized: string): string {
  const words: string[] = [];
  const parts = normalized.split(/\s+/).filter(Boolean);

  for (const [position, word] of parts.entries()) {
    if (position > 0 && CONNECTORS.has(word)) {
      // «Comunitat de Propietaris», no «Comunitat DE Propietaris».
      words.push(word.toLowerCase());
    } else if (
      COMPANY_SUFFIXES.has(word) ||
      (word.length <= 3 && esMajuscules(word) && !esNumero(word) && !SHORT_WORDS.has(word))
    ) {
      // Sigles i codis curts com SA, SL o 4B es deixen tal qual.
      words.push(word);
    } else {
      words.push(capitalitza(word));
    }
  }

  return words.join(" ");
}

/**
 * Retorna `[clau normalitzada, nom per mostrar]`.
 *
 * La clau es en majuscules i sense accents, apta per agrupar. El nom per
 * mostrar es el mateix text amb una capitalitzacio llegible.
 */
export function normalizeDescription(description: string, counterparty = ""): [string, string] {
  // Si el banc ja dona la contrapart, es molt mes fiable que el concepte lliure.
  const source = counterparty.trim() || description.trim();
  if (!source) return ["", ""];

  let text = stripAccents(source).toUpperCase();

  // Les operacions sense comerç es resolen abans de res (nomes a l'inici).
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
      // Amb un prefix conegut, el que va despres d'una coma sol ser la poblacio.
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
    const ultim = tokens[tokens.length - 1] as string;
    if (TRAILING_NOISE.has(ultim) || esNumero(ultim)) tokens.pop();
    else break;
  }
  while (tokens.length > 0) {
    const primer = tokens[0] as string;
    if (esNumero(primer) || LEADING_STOPWORDS.has(primer) || MONTHS.has(primer)) tokens.shift();
    else break;
  }

  // Els noms molt llargs es retallen: la cua sol ser referencia interna.
  const normalized = retallaExtrems(tokens.slice(0, 6).join(" ").slice(0, 200), " .");
  if (!normalized) {
    // Si nomes hi havia el prefix d'operacio, no el reciclem com a nom de
    // comerç: totes les «PAGO MOVIL EN» buides acabarien al mateix lloc.
    if (haTretPrefix) return ["", ""];
    // Sense prefix: millor alguna clau que deixar el moviment sense nom.
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
