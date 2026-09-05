/**
 * Parseig del concepte del banc **nomes per mostrar**.
 *
 * No toca la base de dades ni la normalitzacio del comerç. Treu del text el
 * que no es el concepte (targeta, comissio, cues de lloc) i n'extreu els
 * darrers 4 digits de la targeta, si n'hi ha, per al xip de la UI.
 */

import { stripAccents } from "./normalization.ts";

/** Tipus d'operacio deduit del prefix del concepte bancari. */
export type TipusOperacio = "targeta" | "transferencia" | "bizum" | "rebut" | "altres";

export const TIPUS_OPERACIO = [
  "targeta",
  "transferencia",
  "bizum",
  "rebut",
  "altres",
] as const satisfies readonly TipusOperacio[];

export interface ConcepteParsejat {
  /** Text net per a la columna Concepte. */
  titol: string;
  /** Darrers 4 digits de la targeta, o null si no n'hi ha. */
  darrers4: string | null;
  /** Text bancari sense PAN/targeta/comissio: per al `title` del boto. */
  originalNetejat: string;
  /** Tipus d'operacio per a l'etiqueta i el filtre. */
  tipus: TipusOperacio;
}

/** Prefixos d'operacio que no formen part del concepte llegible. */
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
  // IMMEDIATA/URGENTE abans de la direccio; alternatives llargues abans de DE/A.
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

/** Detecta el tipus abans de treure el prefix (sobre el text cru). */
export function detectaTipusOperacio(text: string): TipusOperacio {
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
/**
 * Extreu els darrers 4 digits i treu del text qualsevol mencio de targeta.
 *
 * Accepta `TARJ. :*484017`, `TARJETA 5489010385484017` i PANs nus de 13–19
 * digits etiquetats. Mai deixa un bloc de 13–19 digits al titol.
 */
function treuTargeta(text: string): { text: string; darrers4: string | null } {
  let darrers4: string | null = null;
  let net = text;

  const marcar = (digits: string) => {
    const nets = digits.replace(/\D/g, "");
    if (nets.length >= 4) darrers4 = nets.slice(-4);
  };

  // TARJ. / TARJETA + digits (amb o sense * i :).
  net = net.replace(/\bTARJ(?:ETA)?\.?\s*:?\s*\*?(\d{4,19})\b/gi, (_m, digits: string) => {
    marcar(digits);
    return " ";
  });

  // PAN emmascarat amb X o *: 5402XXXXXXXX1234, 1234******5678
  net = net.replace(/\b\d{2,6}[X*]{3,}(\d{2,6})\b/gi, (_m, cua: string) => {
    marcar(cua);
    return " ";
  });
  net = net.replace(/\b[X*]{4,}(\d{2,6})\b/gi, (_m, cua: string) => {
    marcar(cua);
    return " ";
  });

  // PAN sencer etiquetat residual (per si queda sense la paraula TARJETA).
  net = net.replace(/\b(\d{13,19})\b/g, (_m, digits: string) => {
    marcar(digits);
    return " ";
  });

  // Formes emmascarades residual: *484017 o ****4017
  net = net.replace(/\*{1,}\d{2,6}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 4 && !darrers4) darrers4 = digits.slice(-4);
    return " ";
  });

  return { text: net, darrers4 };
}

function treuComissio(text: string): string {
  return text.replace(/\bCOMISI[OÓ]N\s+\d+[.,]\d{2}\b/gi, " ");
}

/**
 * Part humana d'un `concepto:`: trossos separats per `/`, descartant cadastre
 * i quotes (`Q.IBI 95,25`).
 */
function trossosConcepte(despres: string): string {
  const parts = despres
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const humans: string[] = [];

  for (const part of parts) {
    // Cadastre i referencies internes.
    if (/^RCAD\s*:/i.test(part)) continue;
    // Quotes: «Q.IBI 95,25», «Q.TM 6,51».
    if (/^Q\.\s*[A-Z]+\s+\d/i.test(part)) continue;
    // Cues numeriques curtes: «0066», «07746», «P0202».
    if (/^[P]?\d{3,6}$/i.test(part)) continue;
    // Cadastre nu: nomes alfanumeric llarg, sense + / - (que marquen un concepte).
    if (!/[+/-]/.test(part) && !/\s/.test(part)) {
      const alnum = part.replace(/[^A-Z0-9]/gi, "");
      if (alnum.length >= 10 && alnum === part.replace(/[^A-Z0-9]/gi, "")) {
        continue;
      }
    }
    // Despres de la coma en un tros «Torre dels Pardals,0066, P0202 …»
    // ens quedem amb el que hi ha abans de la primera coma amb digits.
    let net = part;
    const comaAmbRef = /,\s*(?:\d|[PQ]\d)/i.exec(net);
    if (comaAmbRef && comaAmbRef.index !== undefined) {
      net = net.slice(0, comaAmbRef.index).trim();
    }
    // Treu cues «Q.IBI …» encara dins del mateix tros.
    net = net.replace(/\s+Q\.\s*[A-Z]+\s+\d+[.,]\d{2}.*$/i, "").trim();
    if (!net) continue;
    if (!/[+/-]/.test(net) && !/\s/.test(net)) {
      const alnum = net.replace(/[^A-Z0-9]/gi, "");
      if (alnum.length >= 10) continue;
    }
    humans.push(net);
  }

  return humans.join(" · ");
}

function treuPrefix(text: string): string {
  const net = text.trim();
  for (const pattern of PREFIXOS) {
    const replaced = net.replace(pattern, "");
    if (replaced !== net) {
      return replaced.trim();
    }
  }
  return net;
}

/**
 * Cua de lloc: «, LLANÑA ES», «, LUXEMBOURG», «, CALELLA PALAFES».
 *
 * Nomes talla despres d'una coma si el que queda sembla poblacio/pais
 * (poques paraules, sense digitos de negoci).
 */
function treuCuaLloc(text: string): string {
  // Ultima coma + cua en majuscules / pais (ignora comes finals).
  const match = /^(.*?),\s*([A-ZÀ-ÜÑ][A-ZÀ-ÜÑa-zà-üñ' .-]{0,40})\s*,?\s*$/u.exec(text.trim());
  if (!match) return text.trim().replace(/,+\s*$/, "");
  const cap = (match[1] ?? "").trim();
  const cua = (match[2] ?? "").trim();
  if (!cap) return text.trim();
  // La cua no ha de semblar un nom de comerç llarg: max 3 paraules.
  const paraules = cua.split(/\s+/).filter(Boolean);
  if (paraules.length === 0 || paraules.length > 3) return text.trim();
  // Si la cua te digits de negoci (codis d'Amazon, etc.), no es lloc.
  if (/\d/.test(cua)) return text.trim();
  return cap;
}

function treuSorollWeb(text: string): string {
  let net = text.trim();
  net = net.replace(/^WWW\./i, "");
  // Sufix de referencia Amazon: *QE6I19905
  net = net.replace(/\*[A-Z0-9]{5,}\b/gi, "");
  return net.trim();
}

function netejaEspais(text: string): string {
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
 * Title-case per a la UI. A diferencia de `displayName` (clau de comerç),
 * «APP» es «App»: aqui no volem sigles de tres lletres.
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
 * Capitalitza nomes si el text ve tot en majuscules (tipic de les compres).
 * Els noms de transferencia amb accents o minuscules es deixen tal qual.
 */
function presenta(text: string): string {
  const net = text.trim();
  if (!net) return net;
  // Conserva el casing del banc si ja porta minuscules.
  if (/[a-zà-üñ]/.test(net)) {
    return net;
  }
  // Titol compost (concepte de rebut amb ·): cada tros a part.
  if (net.includes(" · ")) {
    return net
      .split(" · ")
      .map((tros) => {
        if (/[+/-]/.test(tros)) return tros;
        const c = stripAccents(tros)
          .toUpperCase()
          .replace(/[^A-Z0-9&'.\s]/g, " ")
          .trim();
        return c ? titolLlegible(c) : tros;
      })
      .join(" · ");
  }
  // Conserva + / - en codis tipus IBI+TM2026-3T.
  if (/[+/-]/.test(net) && !/\s/.test(net)) {
    return net;
  }
  const clau = stripAccents(net)
    .toUpperCase()
    .replace(/[^A-Z0-9&'.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clau ? titolLlegible(clau) : net;
}

/**
 * Parseja un concepte bancari per a la UI.
 *
 * Si no reconeix el patro, torna el text original **sense** PAN, targeta ni
 * comissio. Millor un concepte una mica brut que un numero de targeta.
 */
export function parsejaConcepte(text: string): ConcepteParsejat {
  const cru = text.trim();
  if (!cru) {
    return { titol: "", darrers4: null, originalNetejat: "", tipus: "altres" };
  }

  const tipus = detectaTipusOperacio(cru);
  const { text: senseTargeta, darrers4 } = treuTargeta(cru);
  const senseComissio = treuComissio(senseTargeta);
  const originalNetejat = netejaEspais(senseComissio);

  // «concepto:» — el titol es el que ve despres.
  const matchConcepte = /(?:^|[,;]\s*)concepto\s*:\s*(.*)$/i.exec(originalNetejat);
  if (matchConcepte) {
    const despres = (matchConcepte[1] ?? "").trim();
    const humans = trossosConcepte(despres);
    const titol = presenta(humans || despres);
    return {
      titol: titol || originalNetejat,
      darrers4,
      originalNetejat,
      tipus,
    };
  }

  let cos = originalNetejat;
  cos = treuPrefix(cos);
  // «EN MERCADONA» despres de treure COMPRA TARJ.
  cos = cos.replace(/^(?:EN|A|DE|DEL|LA|EL|POR)\s+/i, "");
  cos = treuCuaLloc(cos);
  // Pot haver-hi mes d'una cua («, LUXEMBOURG» despres de treure el prefix).
  cos = treuCuaLloc(cos);
  cos = treuSorollWeb(cos);
  cos = netejaEspais(cos);

  // Seguretat: cap bloc de 13–19 digits ha de sobreviure.
  cos = cos.replace(/\b\d{13,19}\b/g, " ");
  cos = netejaEspais(cos);

  const titol = presenta(cos);
  return {
    titol: titol || originalNetejat,
    darrers4,
    originalNetejat,
    tipus,
  };
}
