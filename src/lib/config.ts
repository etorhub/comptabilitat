/**
 * Configuration, read from environment variables.
 *
 * The names are **exactly** those of `backend/app/config.py`, so the existing
 * `deploy/.env` keeps working untouched.
 *
 * The Enable Banking private key is read here once and is never logged
 * anywhere: see `lib/enablebanking`.
 *
 * The operator-facing messages below stay in Catalan: whoever runs this reads
 * Catalan.
 */

import { z } from "zod/v4";

const csv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isNaN(parsed) ? fallback : parsed;
};

const env = process.env;

/**
 * The current deployment's `DATABASE_URL` carries SQLAlchemy's prefix
 * (`postgresql+psycopg://`). Bun's driver does not understand it, and changing
 * the variable would break the Python container while the two coexist, so it
 * is cleaned up here.
 */
function normalizeUrl(url: string): string {
  return url.replace(/^postgresql\+\w+:\/\//, "postgresql://");
}

const rawConfig = {
  // --- General ---
  appName: env.APP_NAME ?? "Comptabilitat",
  environment: env.ENVIRONMENT ?? "development",
  debug: bool(env.DEBUG, false),
  timezone: env.TIMEZONE ?? "Europe/Madrid",
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? "http://localhost:8000").replace(/\/$/, ""),
  port: int(env.PORT, 8000),

  // --- Database ---
  databaseUrl: normalizeUrl(
    env.DATABASE_URL ?? "postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat",
  ),

  // --- Sessions and security ---
  secretKey: env.SECRET_KEY ?? "canvia-aquesta-clau-en-produccio",
  sessionCookieName: env.SESSION_COOKIE_NAME ?? "comptabilitat_session",
  sessionMaxAgeDays: int(env.SESSION_MAX_AGE_DAYS, 14),
  cookieSecure: bool(env.COOKIE_SECURE, true),

  // --- Enable Banking ---
  ebApiOrigin: env.EB_API_ORIGIN ?? "https://api.enablebanking.com",
  ebApplicationId: env.EB_APPLICATION_ID ?? "",
  ebPrivateKeyPath: env.EB_PRIVATE_KEY_PATH ?? "/run/secrets/eb_private_key",
  ebPrivateKey: env.EB_PRIVATE_KEY ?? "",
  ebPrivateKeyB64: env.EB_PRIVATE_KEY_B64 ?? "",
  ebDefaultAspspName: env.EB_DEFAULT_ASPSP_NAME ?? "Santander",
  ebDefaultAspspCountry: env.EB_DEFAULT_ASPSP_COUNTRY ?? "ES",
  ebConsentDays: int(env.EB_CONSENT_DAYS, 90),
  ebInitialHistoryMonths: int(env.EB_INITIAL_HISTORY_MONTHS, 24),
  ebResyncOverlapDays: int(env.EB_RESYNC_OVERLAP_DAYS, 7),

  // --- Ollama ---
  ollamaEnabled: bool(env.OLLAMA_ENABLED, false),
  ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://ollama:11434",
  ollamaModel: env.OLLAMA_MODEL ?? "qwen3:4b",
  ollamaTimeoutSeconds: int(env.OLLAMA_TIMEOUT_SECONDS, 180),
  ollamaMinConfidence: num(env.OLLAMA_MIN_CONFIDENCE, 0.55),

  // --- Mail ---
  smtpHost: env.SMTP_HOST ?? "",
  smtpPort: int(env.SMTP_PORT, 587),
  smtpUser: env.SMTP_USER ?? "",
  smtpPassword: env.SMTP_PASSWORD ?? "",
  smtpFrom: env.SMTP_FROM ?? "",
  smtpStarttls: bool(env.SMTP_STARTTLS, true),
  alertRecipients: csv(env.ALERT_RECIPIENTS),

  // --- Scheduler ---
  schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
  syncCronHour: int(env.SYNC_CRON_HOUR, 6),
  syncCronMinute: int(env.SYNC_CRON_MINUTE, 30),
  classifyCronHour: int(env.CLASSIFY_CRON_HOUR, 3),
  analysisCronHour: int(env.ANALYSIS_CRON_HOUR, 4),
  notifyCronHour: int(env.NOTIFY_CRON_HOUR, 8),

  // --- Forecast ---
  forecastHorizonDays: int(env.FORECAST_HORIZON_DAYS, 90),
} as const;

export type Config = typeof rawConfig;

export const config = rawConfig;

/**
 * The bank's callback URL. It has to match, character for character, the one
 * configured in the Enable Banking dashboard.
 */
export const ebRedirectUrl = `${config.publicBaseUrl}/api/auth/callback`;

/**
 * A function and not a constant because it is read when mail is sent, not when
 * the module is imported: that way tests can change the configuration and this
 * notices.
 */
export function smtpConfigured(): boolean {
  return (
    Boolean(config.smtpHost) && Boolean(config.smtpFrom) && config.alertRecipients.length > 0
  );
}

/**
 * Checks that only make sense when this runs for real. In development they
 * warn; in production they stop startup, because a default session key means
 * anyone can sign themselves a cookie.
 */
export function validateConfig(): void {
  const problems: string[] = [];

  if (config.secretKey === "canvia-aquesta-clau-en-produccio") {
    problems.push("SECRET_KEY es la de per defecte");
  }
  if (config.secretKey.length < 32) {
    problems.push("SECRET_KEY hauria de tenir 32 carácters o mes");
  }
  if (!config.cookieSecure) {
    problems.push("COOKIE_SECURE es fals: la galeta de sessio viatjara sense HTTPS");
  }
  if (!z.string().url().safeParse(config.publicBaseUrl).success) {
    problems.push(`PUBLIC_BASE_URL no es una URL valida: ${config.publicBaseUrl}`);
  }

  if (problems.length === 0) return;

  const message = problems.map((p) => `  - ${p}`).join("\n");
  if (config.environment === "production") {
    throw new Error(`Configuracio insegura per a produccio:\n${message}`);
  }
  console.warn(`[config] avisos (no son fatals fora de produccio):\n${message}`);
}
