/**
 * Bank connections, accounts, balances and sync attempts.
 *
 * Connections are **shared** between workspaces: the installation's
 * administrator manages them. Accounts, by contrast, are assigned to a
 * workspace (`ledgerId`), and until they have one their transactions are not
 * visible anywhere.
 */

import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { domainEnum, money, timestamps, tz } from "./columns.ts";
import type { ConnectionStatus, SyncStatus, SyncTrigger } from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { users } from "./users.ts";

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: serial().notNull(),
    name: varchar({ length: 120 }).notNull(),
    aspspName: varchar("aspsp_name", { length: 120 }).notNull(),
    aspspCountry: varchar("aspsp_country", { length: 2 }).notNull(),
    psuType: varchar("psu_type", { length: 20 }).notNull(),
    /** The Enable Banking session opened after strong authentication. */
    ebSessionId: varchar("eb_session_id", { length: 128 }),
    /**
     * A single-use state tying the bank's callback to the connection that
     * started it. It is the secret protecting the callback route, which cannot
     * be authenticated because whoever arrives there comes from the bank.
     */
    ebAuthState: varchar("eb_auth_state", { length: 128 }),
    status: domainEnum<ConnectionStatus>().notNull(),
    /** Consent expiry: under PSD2, 90 days at most. */
    validUntil: tz("valid_until"),
    lastSyncAt: tz("last_sync_at"),
    lastError: text("last_error").notNull(),
    createdById: integer("created_by_id"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_bank_connections", columns: [t.id] }),
    index("ix_bank_connections_eb_auth_state").on(t.ebAuthState),
    foreignKey({
      name: "fk_bank_connections_created_by_id_users",
      columns: [t.createdById],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    unique("uq_bank_connections_eb_session_id").on(t.ebSessionId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial().notNull(),
    connectionId: integer("connection_id").notNull(),
    /** Null = an account with no workspace yet: not visible from any of them. */
    ledgerId: integer("ledger_id"),
    ebAccountUid: varchar("eb_account_uid", { length: 128 }).notNull(),
    name: varchar({ length: 160 }).notNull(),
    product: varchar({ length: 120 }).notNull(),
    /** Personal data: only the masked form ever reaches a template. */
    iban: varchar({ length: 34 }).notNull(),
    currency: varchar({ length: 3 }).notNull(),
    cashAccountType: varchar("cash_account_type", { length: 20 }).notNull(),
    usage: varchar({ length: 20 }).notNull(),
    isActive: boolean("is_active").notNull(),
    historyStartDate: date("history_start_date"),
    /** How far transactions have been fetched; the sync window starts from here. */
    lastBookedDate: date("last_booked_date"),
    /**
     * The bank's whole response. It contains personal data (names, IBANs). It
     * is never rendered and never enters a fragment: see `AGENTS.md`.
     */
    raw: jsonb().notNull().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_accounts", columns: [t.id] }),
    index("ix_accounts_connection_id").on(t.connectionId),
    index("ix_accounts_ledger_id").on(t.ledgerId),
    foreignKey({
      name: "fk_accounts_connection_id_bank_connections",
      columns: [t.connectionId],
      foreignColumns: [bankConnections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_accounts_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("set null"),
    unique("uq_accounts_eb_account_uid").on(t.ebAccountUid),
  ],
);

/** No `TimestampMixin`: whoever inserts sets `fetched_at`. */
export const balances = pgTable(
  "balances",
  {
    id: serial().notNull(),
    accountId: integer("account_id").notNull(),
    balanceType: varchar("balance_type", { length: 40 }).notNull(),
    amount: money().notNull(),
    currency: varchar({ length: 3 }).notNull(),
    referenceDate: date("reference_date").notNull(),
    fetchedAt: tz("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_balances", columns: [t.id] }),
    index("ix_balances_account_id").on(t.accountId),
    foreignKey({
      name: "fk_balances_account_id_accounts",
      columns: [t.accountId],
      foreignColumns: [accounts.id],
    }).onDelete("cascade"),
    unique("uq_balance_account_type_date").on(t.accountId, t.balanceType, t.referenceDate),
  ],
);

/** No `TimestampMixin`: each attempt carries its own `started_at`. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial().notNull(),
    connectionId: integer("connection_id").notNull(),
    trigger: domainEnum<SyncTrigger>().notNull(),
    status: domainEnum<SyncStatus>().notNull(),
    startedAt: tz("started_at").notNull(),
    finishedAt: tz("finished_at"),
    accountsSynced: integer("accounts_synced").notNull(),
    transactionsInserted: integer("transactions_inserted").notNull(),
    transactionsUpdated: integer("transactions_updated").notNull(),
    error: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_sync_runs", columns: [t.id] }),
    index("ix_sync_runs_connection_id").on(t.connectionId),
    // Used to check the daily call limit the bank imposes.
    index("ix_sync_runs_started_at").on(t.startedAt),
    foreignKey({
      name: "fk_sync_runs_connection_id_bank_connections",
      columns: [t.connectionId],
      foreignColumns: [bankConnections.id],
    }).onDelete("cascade"),
  ],
);

export type BankConnection = typeof bankConnections.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
