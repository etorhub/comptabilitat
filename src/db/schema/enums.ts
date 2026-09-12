/**
 * Domain enums.
 *
 * In the database these are not native PostgreSQL types: they are `varchar(32)`
 * storing the text value, and **with no CHECK constraint** (checked against
 * the live schema: zero check constraints in the whole thing). So what
 * guarantees the value is good is not the database but this file: the tables
 * declare them with `$type<...>()` and the forms validate them with the Zod
 * schemas below.
 *
 * The values are exactly those of `backend/app/models/enums.py`. None can be
 * changed without migrating the rows already using it.
 */

import { z } from "zod/v4";

/** Helper: a non-empty tuple of literals, to build a `z.enum` and a type from. */
const values = <const T extends readonly [string, ...string[]]>(...v: T): T => v;

// --- Workspaces ------------------------------------------------------------

export const LEDGER_ROLES = values("viewer", "editor", "admin");
export type LedgerRole = (typeof LEDGER_ROLES)[number];
export const ledgerRoleSchema = z.enum(LEDGER_ROLES);

/**
 * The role hierarchy. `editor` can do everything `viewer` can, and `admin`
 * everything `editor` can. Compared by level, never by equality.
 */
export const LEDGER_ROLE_LEVEL: Record<LedgerRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export function roleAtLeast(role: LedgerRole | null, min: LedgerRole): boolean {
  if (role === null) return false;
  return LEDGER_ROLE_LEVEL[role] >= LEDGER_ROLE_LEVEL[min];
}

// --- Bank connections ------------------------------------------------------

export const CONNECTION_STATUSES = values("pending", "active", "expired", "revoked", "error");
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

export const SYNC_STATUSES = values("running", "success", "partial", "failed");
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const syncStatusSchema = z.enum(SYNC_STATUSES);

/** A `SyncRun` moves no further: this is what stops the UI's polling. */
export const TERMINAL_SYNC_STATUSES: readonly SyncStatus[] = ["success", "partial", "failed"];

export function isSyncFinished(status: SyncStatus): boolean {
  return TERMINAL_SYNC_STATUSES.includes(status);
}

export const SYNC_TRIGGERS = values("scheduled", "manual", "initial");
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
export const syncTriggerSchema = z.enum(SYNC_TRIGGERS);

// --- Scheduler jobs --------------------------------------------------------

/** Same values as `SyncStatus`: a job run has the same lifecycle. */
export const JOB_STATUSES = SYNC_STATUSES;
export type JobStatus = SyncStatus;
export const jobStatusSchema = syncStatusSchema;

export const TERMINAL_JOB_STATUSES = TERMINAL_SYNC_STATUSES;
export function isJobFinished(status: JobStatus): boolean {
  return isSyncFinished(status);
}

/** Where the job was started from. `manual` = the admin UI. */
export const JOB_TRIGGERS = values("scheduled", "manual", "cli");
export type JobTrigger = (typeof JOB_TRIGGERS)[number];
export const jobTriggerSchema = z.enum(JOB_TRIGGERS);

// --- Transactions ----------------------------------------------------------

export const TRANSACTION_STATUSES = values("booked", "pending");
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const transactionStatusSchema = z.enum(TRANSACTION_STATUSES);

export const TRANSACTION_SOURCES = values("enablebanking", "manual");
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export const transactionSourceSchema = z.enum(TRANSACTION_SOURCES);

// --- Categories and classification -----------------------------------------

export const CATEGORY_KINDS = values("income", "expense", "transfer");
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const categoryKindSchema = z.enum(CATEGORY_KINDS);

/**
 * Where a transaction's category came from. The order matters: `user` is a
 * person's decision and nothing ever overwrites it (see
 * `services/classification`).
 */
export const CATEGORY_SOURCES = values("none", "merchant", "rule", "llm", "user");
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
export const categorySourceSchema = z.enum(CATEGORY_SOURCES);

// --- Rules -----------------------------------------------------------------

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

// --- Recurring series ------------------------------------------------------

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

/** How many days each cadence lasts, so an observed interval can be matched. */
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 61,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

/**
 * The lifecycle of an expected bill (a schedule): the detector only
 * **proposes** (`suggested`); the person confirms (`active`) or dismisses
 * (`dismissed`). `ended` is when it stops appearing.
 */
export const SERIES_STATUSES = values("suggested", "active", "ended", "dismissed");
export type SeriesStatus = (typeof SERIES_STATUSES)[number];
export const seriesStatusSchema = z.enum(SERIES_STATUSES);

/**
 * How the amount is estimated in the forecast: a confirmed fixed value, or the
 * average of recent occurrences (water, electricity).
 */
export const AMOUNT_MODES = values("exact", "average");
export type AmountMode = (typeof AMOUNT_MODES)[number];
export const amountModeSchema = z.enum(AMOUNT_MODES);

// --- Alerts ----------------------------------------------------------------

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
