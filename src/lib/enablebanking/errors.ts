/**
 * Errors d'Enable Banking.
 *
 * Es distingeixen perque la sincronitzacio hi reacciona diferent: un
 * consentiment caducat vol dir avisar i marcar la connexio, i una finestra de
 * dates rebutjada vol dir tornar-ho a provar amb una de mes curta.
 */

/** Camps de la resposta del banc que poden dur dades personals. */
const FIELDS_SENSIBLES = [
  "psu",
  "account",
  "accounts",
  "iban",
  "holder",
  "name",
  "debtor",
  "creditor",
];

export class EnableBankingError extends Error {
  readonly statusCode: number | null;
  readonly code: string | null;
  readonly payload: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      statusCode?: number | null;
      code?: string | null;
      payload?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "EnableBankingError";
    this.statusCode = options.statusCode ?? null;
    this.code = options.code ?? null;
    this.payload = cleanPayload(options.payload ?? {});
  }
}

/** El consentiment ha caducat: cal tornar a autoritzar amb autenticacio forta. */
export class SessionExpiredError extends EnableBankingError {
  override readonly name = "SessionExpiredError";
}

/** El banc no accepta la finestra de dates demanada. */
export class DateRangeError extends EnableBankingError {
  override readonly name = "DateRangeError";
}

/** Falta l'identificador d'aplicacio o la clau privada. */
export class MissingCredentialsError extends EnableBankingError {
  override readonly name = "MissingCredentialsError";
}

/**
 * Treu del cos de l'error tot el que pugui dur dades personals.
 *
 * El `payload` d'un error pot acabar a `#toast` o al registre, i la resposta
 * del banc hi pot dur noms, IBAN i contraparts. Aixo es una xarxa, no una
 * excusa per ensenyar-lo: el que arriba a la pantalla es el missatge.
 */
function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, valor] of Object.entries(payload)) {
    const minuscula = key.toLowerCase();
    if (FIELDS_SENSIBLES.some((sensible) => minuscula.includes(sensible))) continue;
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
      cleaned[key] = valor;
    }
  }
  return cleaned;
}
