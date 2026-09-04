/**
 * Configuracio, llegida de variables d'entorn.
 *
 * Els noms son **exactament** els de `backend/app/config.py`, de manera que el
 * `deploy/.env` que ja hi ha continua servint sense tocar-hi res.
 *
 * La clau privada d'Enable Banking es llegeix aqui un sol cop i no es registra
 * mai enlloc: vegeu `lib/enablebanking`.
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
 * El `DATABASE_URL` del desplegament actual ve amb el prefix de SQLAlchemy
 * (`postgresql+psycopg://`). El driver de Bun no l'enten, i canviar la
 * variable trencaria el contenidor de Python mentre convisquin, aixi que el
 * netegem aqui.
 */
function normalitzaUrl(url: string): string {
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

  // --- Base de dades ---
  databaseUrl: normalitzaUrl(
    env.DATABASE_URL ?? "postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat",
  ),

  // --- Sessions i seguretat ---
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

  // --- Correu ---
  smtpHost: env.SMTP_HOST ?? "",
  smtpPort: int(env.SMTP_PORT, 587),
  smtpUser: env.SMTP_USER ?? "",
  smtpPassword: env.SMTP_PASSWORD ?? "",
  smtpFrom: env.SMTP_FROM ?? "",
  smtpStarttls: bool(env.SMTP_STARTTLS, true),
  alertRecipients: csv(env.ALERT_RECIPIENTS),

  // --- Planificador ---
  schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
  syncCronHour: int(env.SYNC_CRON_HOUR, 6),
  syncCronMinute: int(env.SYNC_CRON_MINUTE, 30),
  classifyCronHour: int(env.CLASSIFY_CRON_HOUR, 3),
  analysisCronHour: int(env.ANALYSIS_CRON_HOUR, 4),
  notifyCronHour: int(env.NOTIFY_CRON_HOUR, 8),

  // --- Previsio ---
  forecastHorizonDays: int(env.FORECAST_HORIZON_DAYS, 90),
} as const;

export type Config = typeof rawConfig;

export const config = rawConfig;

/** URL de retorn del banc. Ha de coincidir carácter per carácter amb la
 * que hi ha configurada al panell d'Enable Banking. */
export const ebRedirectUrl = `${config.publicBaseUrl}/api/auth/callback`;

/**
 * Es funcio i no constant perque es llegeix quan s'envia, no quan s'importa:
 * aixi les proves poden canviar la configuracio i aixo se n'assabenta.
 */
export function smtpConfigured(): boolean {
  return (
    Boolean(config.smtpHost) && Boolean(config.smtpFrom) && config.alertRecipients.length > 0
  );
}

/**
 * Comprovacions que nomes tenen sentit quan aixo corre de debò. En
 * desenvolupament avisen; en produccio, aturen l'arrencada, perque una clau de
 * sessio per defecte vol dir que qualsevol pot signar-se una galeta.
 */
export function validateConfig(): void {
  const problemes: string[] = [];

  if (config.secretKey === "canvia-aquesta-clau-en-produccio") {
    problemes.push("SECRET_KEY es la de per defecte");
  }
  if (config.secretKey.length < 32) {
    problemes.push("SECRET_KEY hauria de tenir 32 carácters o mes");
  }
  if (!config.cookieSecure) {
    problemes.push("COOKIE_SECURE es fals: la galeta de sessio viatjara sense HTTPS");
  }
  if (!z.string().url().safeParse(config.publicBaseUrl).success) {
    problemes.push(`PUBLIC_BASE_URL no es una URL valida: ${config.publicBaseUrl}`);
  }

  if (problemes.length === 0) return;

  const missatge = problemes.map((p) => `  - ${p}`).join("\n");
  if (config.environment === "production") {
    throw new Error(`Configuracio insegura per a produccio:\n${missatge}`);
  }
  console.warn(`[config] avisos (no son fatals fora de produccio):\n${missatge}`);
}
