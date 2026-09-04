/**
 * Enumeracions del domini.
 *
 * A la base de dades no son tipus natius de PostgreSQL: son `varchar(32)` que
 * hi desen el valor de text, i **sense cap restriccio CHECK** (aixo ho hem
 * comprovat contra l'esquema viu: zero check constraints a tot l'esquema).
 * Qui garanteix que el valor sigui bo, doncs, no es la base de dades sino
 * aquest fitxer: les taules els declaren amb `$type<...>()` i els formularis
 * els validen amb els esquemes de Zod que hi ha aqui sota.
 *
 * Els valors son exactament els de `backend/app/models/enums.py`. No se'n pot
 * canviar cap sense migrar les files que ja el fan servir.
 */

import { z } from "zod/v4";

/** Helper: una tupla no buida de literals, per fer-ne `z.enum` i un tipus. */
const values = <const T extends readonly [string, ...string[]]>(...v: T): T => v;

// --- Espais de treball -----------------------------------------------------

export const LEDGER_ROLES = values("viewer", "editor", "admin");
export type LedgerRole = (typeof LEDGER_ROLES)[number];
export const ledgerRoleSchema = z.enum(LEDGER_ROLES);

/**
 * Jerarquia de rols. `editor` pot tot el que pot `viewer`, i `admin` tot el
 * que pot `editor`. Es compara pel nivell, mai per igualtat.
 */
export const LEDGER_ROLE_LEVEL: Record<LedgerRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export function roleAtLeast(role: LedgerRole | null, minim: LedgerRole): boolean {
  if (role === null) return false;
  return LEDGER_ROLE_LEVEL[role] >= LEDGER_ROLE_LEVEL[minim];
}

// --- Connexions bancaries --------------------------------------------------

export const CONNECTION_STATUSES = values("pending", "active", "expired", "revoked", "error");
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

export const SYNC_STATUSES = values("running", "success", "partial", "failed");
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const syncStatusSchema = z.enum(SYNC_STATUSES);

/** Un `SyncRun` ja no es mou d'aqui: serveix per aturar el sondeig de la UI. */
export const TERMINAL_SYNC_STATUSES: readonly SyncStatus[] = ["success", "partial", "failed"];

export function isSyncFinished(status: SyncStatus): boolean {
  return TERMINAL_SYNC_STATUSES.includes(status);
}

export const SYNC_TRIGGERS = values("scheduled", "manual", "initial");
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
export const syncTriggerSchema = z.enum(SYNC_TRIGGERS);

// --- Moviments -------------------------------------------------------------

export const TRANSACTION_STATUSES = values("booked", "pending");
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const transactionStatusSchema = z.enum(TRANSACTION_STATUSES);

export const TRANSACTION_SOURCES = values("enablebanking", "manual");
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export const transactionSourceSchema = z.enum(TRANSACTION_SOURCES);

// --- Categories i classificacio --------------------------------------------

export const CATEGORY_KINDS = values("income", "expense", "transfer");
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const categoryKindSchema = z.enum(CATEGORY_KINDS);

/**
 * D'on ve la categoria d'un moviment. L'ordre importa: `user` es la decisio
 * d'una persona i no la sobreescriu mai res (vegeu `services/classification`).
 */
export const CATEGORY_SOURCES = values("none", "merchant", "rule", "llm", "user");
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
export const categorySourceSchema = z.enum(CATEGORY_SOURCES);

// --- Regles ----------------------------------------------------------------

export const RULE_SOURCES = values("user", "learned");
export type RuleSource = (typeof RULE_SOURCES)[number];
export const ruleSourceSchema = z.enum(RULE_SOURCES);

export const RULE_FIELDS = values(
  "description",
  "normalized_description",
  "counterparty",
  "amount",
  "bank_transaction_code",
  "account_id",
);
export type RuleField = (typeof RULE_FIELDS)[number];
export const ruleFieldSchema = z.enum(RULE_FIELDS);

export const RULE_OPERATORS = values("contains", "equals", "starts_with", "regex", "gt", "lt");
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export const ruleOperatorSchema = z.enum(RULE_OPERATORS);

// --- Recurrents ------------------------------------------------------------

export const CADENCES = values(
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
);
export type Cadence = (typeof CADENCES)[number];
export const cadenceSchema = z.enum(CADENCES);

/** Dies que dura cada cadencia, per encaixar-hi un interval observat. */
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 61,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

export const SERIES_STATUSES = values("active", "ended");
export type SeriesStatus = (typeof SERIES_STATUSES)[number];
export const seriesStatusSchema = z.enum(SERIES_STATUSES);

// --- Avisos ----------------------------------------------------------------

export const ALERT_TYPES = values(
  "projected_overdraft",
  "consent_expiring",
  "consent_expired",
  "recurring_amount_change",
  "recurring_missing",
  "sync_failed",
);
export type AlertType = (typeof ALERT_TYPES)[number];
export const alertTypeSchema = z.enum(ALERT_TYPES);

export const ALERT_SEVERITIES = values("info", "warning", "critical");
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const alertSeveritySchema = z.enum(ALERT_SEVERITIES);

export const ALERT_STATUSES = values("new", "read", "dismissed");
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const alertStatusSchema = z.enum(ALERT_STATUSES);
