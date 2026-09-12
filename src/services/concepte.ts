/**
 * Parsing of the bank concept **for display only**.
 *
 * It touches neither the database nor the merchant normalization. It removes
 * from the text what is not the concept (card, commission, place tails) and
 * extracts the card's last 4 digits, if any, for the UI chip.
 */

import { stripAccents } from "./normalization.ts";

/**
 * `OperationType` and `detectOperationType` live in `normalization.ts` now
 * that they decide where the counterparty goes (`services/contraparts.ts`),
 * not just how it is shown. They are re-exported here because this was their
 * original place and so that all the imports need not be touched.
 */
export { detectOperationType, OPERATION_TYPES } from "./normalization.ts";
export type { OperationType } from "./normalization.ts";
import { detectOperationType, type OperationType } from "./normalization.ts";

export interface ParsedDescription {
  /** Clean text for the Concept column. */
  title: string;
  /** Last 4 digits of the card, or null if there are none. */
  darrers4: string | null;
  /** Bank text without PAN/card/commission: for the button's `title`. */
  cleanedOriginal: string;
  /** Operation type for the label and the filter. */
  type: OperationType;
}

/** Operation prefixes that are not part of the readable concept. */
const PREFIXOS: RegExp[] = [
  /^COMPRA\s+INTERNET\s+(?:EN\s+)?/i,
  /^COMPRA\s+WWW\.?/i,
  /^COMPRA\s+(?:CON\s+)?TARJ(?:ETA)?\.?\s*(?:DE\s+CREDITO|DE\s+DEBITO)?\s*/i,
  /^COMPRA\s+EN\s+/i,
  /^COMPRA\s+/i,
  /^PAGO\s+(?:MOVIL|CON\s+MOVIL|TARJETA)\s*(?:EN\s+)?/i,
  /^PAGO\s+EN\s+/i,
  /^PAGO\s+RECIBO\s+/i,
  /^ADEUDO\s+(?:POR\s+)?DOMICILIACION(?:\s+DE)?\s*/i,
  /^ADEUDO\s+/i,
  /^RECIBO\s+(?:DE\s+)?/i,
  // IMMEDIATA/URGENTE before the direction; long alternatives before DE/A.
  /^TRANSFERENCIA\s+(?:(?:IMMEDIATA|URGENTE|ORDINARIA)\s+)*(?:RECIBIDA\s+DE|A\s+FAVOR\s+DE|EMITIDA\s+A|RECIBIDA|DE|A)\s*/i,
  /^TRANSF\.?\s+(?:DE|A)\s*/i,
  /^BIZUM\s+(?:RECIBIDO\s+DE|ENVIADO\s+A|DE|A)\s*/i,
  /^ENVIO\s+BIZUM\s+A?\s*/i,
  /^TRASPASO\s+(?:DE|A)?\s*/i,
  /^INGRESO\s+(?:DE|EN\s+EFECTIVO|POR)?\s*/i,
  /^NOMINA\s+(?:DE|MES)?\s*/i,
  /^PENSION\s+(?:DE)?\s*/i,
  /^REINTEGRO\s+(?:EN\s+)?(?:CAJERO|OFICINA)?\s*/i,
  /^DISPOSICION\s+(?:DE\s+)?EFECTIVO\s*/i,
  /^COMISION\s+(?:DE\s+)?/i,
  /^LIQUIDACION\s+(?:DE\s+)?/i,
  /^DEVOLUCION\s+(?:DE\s+)?/i,
  /^ABONO\s+(?:DE\s+)?/i,
  /^CARGO\s+(?:DE\s+)?/i,
];

/**
 * Extracts the last 4 digits and removes any mention of a card from the text.
 *
 * Accepts `TARJ. :*484017`, `TARJETA 5489010385484017` and bare labelled PANs
 * of 13–19 digits. It never leaves a block of 13–19 digits in the title.
 */
function removeCard(text: string): { text: string; darrers4: string | null } {
  let darrers4: string | null = null;
  let cleaned = text;

  const marcar = (digits: string) => {
    const nets = digits.replace(/\D/g, "");
    if (nets.length >= 4) darrers4 = nets.slice(-4);
  };

  // TARJ. / TARJETA + digits (with or without * and :).
  cleaned = cleaned.replace(
    /\bTARJ(?:ETA)?\.?\s*:?\s*\*?(\d{4,19})\b/gi,
    (_m, digits: string) => {
      marcar(digits);
      return " ";
    },
  );

  // PAN masked with X or *: 5402XXXXXXXX1234, 1234******5678
  cleaned = cleaned.replace(/\b\d{2,6}[X*]{3,}(\d{2,6})\b/gi, (_m, cua: string) => {
    marcar(cua);
    return " ";
  });
  cleaned = cleaned.replace(/\b[X*]{4,}(\d{2,6})\b/gi, (_m, cua: string) => {
    marcar(cua);
    return " ";
  });

  // Residual labelled full PAN (in case it is left without the word TARJETA).
  cleaned = cleaned.replace(/\b(\d{13,19})\b/g, (_m, digits: string) => {
    marcar(digits);
    return " ";
  });

  // Residual masked forms: *484017 or ****4017
  cleaned = cleaned.replace(/\*{1,}\d{2,6}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 4 && !darrers4) darrers4 = digits.slice(-4);
    return " ";
  });

  return { text: cleaned, darrers4 };
}

function stripFee(text: string): string {
  return text.replace(/\bCOMISI[OÓ]N\s+\d+[.,]\d{2}\b/gi, " ");
}

/**
 * Human part of a `concepto:`: pieces separated by `/`, discarding the land
 * registry reference and instalments (`Q.IBI 95,25`).
 */
function descriptionParts(despres: string): string {
  const parts = despres
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const humans: string[] = [];

  for (const part of parts) {
    // Land registry and internal references.
    if (/^RCAD\s*:/i.test(part)) continue;
    // Instalments: «Q.IBI 95,25», «Q.TM 6,51».
    if (/^Q\.\s*[A-Z]+\s+\d/i.test(part)) continue;
    // Short numeric tails: «0066», «07746», «P0202».
    if (/^[P]?\d{3,6}$/i.test(part)) continue;
    // Bare land registry reference: long alphanumeric only, without + / - (which mark a concept).
    if (!/[+/-]/.test(part) && !/\s/.test(part)) {
      const alnum = part.replace(/[^A-Z0-9]/gi, "");
      if (alnum.length >= 10 && alnum === part.replace(/[^A-Z0-9]/gi, "")) {
        continue;
      }
    }
    // After the comma in a piece «Torre dels Pardals,0066, P0202 …» we keep
    // what comes before the first comma with digits.
    let cleaned = part;
    const commaWithRef = /,\s*(?:\d|[PQ]\d)/i.exec(cleaned);
    if (commaWithRef && commaWithRef.index !== undefined) {
      cleaned = cleaned.slice(0, commaWithRef.index).trim();
    }
    // Removes «Q.IBI …» tails still inside the same piece.
    cleaned = cleaned.replace(/\s+Q\.\s*[A-Z]+\s+\d+[.,]\d{2}.*$/i, "").trim();
    if (!cleaned) continue;
    if (!/[+/-]/.test(cleaned) && !/\s/.test(cleaned)) {
      const alnum = cleaned.replace(/[^A-Z0-9]/gi, "");
      if (alnum.length >= 10) continue;
    }
    humans.push(cleaned);
  }

  return humans.join(" · ");
}

function removePrefix(text: string): string {
  const cleaned = text.trim();
  for (const pattern of PREFIXOS) {
    const replaced = cleaned.replace(pattern, "");
    if (replaced !== cleaned) {
      return replaced.trim();
    }
  }
  return cleaned;
}

/**
 * Place tail: «, LLANÑA ES», «, LUXEMBOURG», «, CALELLA PALAFES».
 *
 * It only cuts after a comma if what is left looks like a town/country (few
 * words, without business digits).
 */
function stripTrailingSlot(text: string): string {
  // Last comma + upper-case tail / country (ignores trailing commas).
  const match = /^(.*?),\s*([A-ZÀ-ÜÑ][A-ZÀ-ÜÑa-zà-üñ' .-]{0,40})\s*,?\s*$/u.exec(text.trim());
  if (!match) return text.trim().replace(/,+\s*$/, "");
  const cap = (match[1] ?? "").trim();
  const cua = (match[2] ?? "").trim();
  if (!cap) return text.trim();
  // The tail must not look like a long merchant name: 3 words max.
  const paraules = cua.split(/\s+/).filter(Boolean);
  if (paraules.length === 0 || paraules.length > 3) return text.trim();
  // If the tail has business digits (Amazon codes, etc.), it is not a place.
  if (/\d/.test(cua)) return text.trim();
  return cap;
}

function stripWebNoise(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^WWW\./i, "");
  // Amazon reference suffix: *QE6I19905
  cleaned = cleaned.replace(/\*[A-Z0-9]{5,}\b/gi, "");
  return cleaned.trim();
}

function collapseSpaces(text: string): string {
  return text
    .replace(/\s*[,;]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

const CONNECTORS_TITOL = new Set([
  "DE",
  "DEL",
  "DELS",
  "LA",
  "LES",
  "EL",
  "ELS",
  "I",
  "Y",
  "EN",
  "A",
]);

const SUFIXOS_EMPRESA = new Set([
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

/**
 * Title-case for the UI. Unlike `displayName` (the merchant key), «APP» is
 * «App»: here we do not want three-letter acronyms.
 */
function titolLlegible(majuscules: string): string {
  return majuscules
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      if (SUFIXOS_EMPRESA.has(word)) return word;
      if (i > 0 && CONNECTORS_TITOL.has(word)) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Capitalizes only if the text comes in all capitals (typical of purchases).
 * Transfer names with accents or lower case are left as they are.
 */
function presenta(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return cleaned;
  // Keeps the bank's casing if it already has lower case.
  if (/[a-zà-üñ]/.test(cleaned)) {
    return cleaned;
  }
  // Compound title (direct debit concept with ·): each piece separately.
  if (cleaned.includes(" · ")) {
    return cleaned
      .split(" · ")
      .map((part) => {
        if (/[+/-]/.test(part)) return part;
        const c = stripAccents(part)
          .toUpperCase()
          .replace(/[^A-Z0-9&'.\s]/g, " ")
          .trim();
        return c ? titolLlegible(c) : part;
      })
      .join(" · ");
  }
  // Keeps + / - in codes like IBI+TM2026-3T.
  if (/[+/-]/.test(cleaned) && !/\s/.test(cleaned)) {
    return cleaned;
  }
  const key = stripAccents(cleaned)
    .toUpperCase()
    .replace(/[^A-Z0-9&'.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key ? titolLlegible(key) : cleaned;
}

/**
 * Parses a bank concept for the UI.
 *
 * If it does not recognize the pattern, it returns the original text
 * **without** PAN, card or commission. Better a slightly dirty concept than a card number.
 */
export function parseDescription(text: string): ParsedDescription {
  const raw = text.trim();
  if (!raw) {
    return { title: "", darrers4: null, cleanedOriginal: "", type: "altres" };
  }

  const type = detectOperationType(raw);
  const { text: senseTargeta, darrers4 } = removeCard(raw);
  const withoutFee = stripFee(senseTargeta);
  const cleanedOriginal = collapseSpaces(withoutFee);

  // «concepto:» — the title is what comes after.
  const matchDescription = /(?:^|[,;]\s*)concepto\s*:\s*(.*)$/i.exec(cleanedOriginal);
  if (matchDescription) {
    const despres = (matchDescription[1] ?? "").trim();
    const humans = descriptionParts(despres);
    const title = presenta(humans || despres);
    return {
      title: title || cleanedOriginal,
      darrers4,
      cleanedOriginal,
      type,
    };
  }

  let body = cleanedOriginal;
  body = removePrefix(body);
  // «EN MERCADONA» after removing COMPRA TARJ.
  body = body.replace(/^(?:EN|A|DE|DEL|LA|EL|POR)\s+/i, "");
  body = stripTrailingSlot(body);
  // There can be more than one tail («, LUXEMBOURG» after removing the prefix).
  body = stripTrailingSlot(body);
  body = stripWebNoise(body);
  body = collapseSpaces(body);

  // Safety: no block of 13–19 digits may survive.
  body = body.replace(/\b\d{13,19}\b/g, " ");
  body = collapseSpaces(body);

  const title = presenta(body);
  return {
    title: title || cleanedOriginal,
    darrers4,
    cleanedOriginal,
    type,
  };
}
