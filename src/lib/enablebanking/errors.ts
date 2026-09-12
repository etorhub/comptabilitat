/**
 * Enable Banking errors.
 *
 * They are told apart because the sync reacts differently to each: an expired
 * consent means raising an alert and flagging the connection, while a rejected
 * date window means retrying with a shorter one.
 */

/** Fields of the bank's response that may carry personal data. */
const SENSITIVE_FIELDS = [
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

/** The consent has expired: strong authentication is needed again. */
export class SessionExpiredError extends EnableBankingError {
  override readonly name = "SessionExpiredError";
}

/** The bank will not accept the date window asked for. */
export class DateRangeError extends EnableBankingError {
  override readonly name = "DateRangeError";
}

/** The application id or the private key is missing. */
export class MissingCredentialsError extends EnableBankingError {
  override readonly name = "MissingCredentialsError";
}

/**
 * Strips anything from the error body that might carry personal data.
 *
 * An error's `payload` can end up in `#toast` or in the log, and the bank's
 * response can carry names, IBANs and counterparties. This is a safety net,
 * not an excuse to show it: what reaches the screen is the message.
 */
function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_FIELDS.some((field) => lower.includes(field))) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
