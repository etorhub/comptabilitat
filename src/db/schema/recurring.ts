/**
 * Expected bills (schedules) and their occurrences.
 *
 * The detector only proposes (`suggested`). The person confirms (`active`) or
 * dismisses (`dismissed`). The balance forecast only looks at active series
 * with `include_in_forecast`.
 */

import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { domainEnum, money, timestamps } from "./columns.ts";
import type { AmountMode, Cadence, SeriesStatus } from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { categories, merchants, transactions } from "./transactions.ts";

export const recurringSeries = pgTable(
  "recurring_series",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    /**
     * Identifies the series: `category|counterparty|direction`, for example
     * `c12|m34|in` or `c12|-|out` (see the signature helper in
     * `services/recurring.ts`).
     */
    signature: varchar({ length: 220 }).notNull(),
    label: varchar({ length: 200 }).notNull(),
    merchantId: integer("merchant_id"),
    categoryId: integer("category_id").notNull(),
    cadence: domainEnum<Cadence>().notNull(),
    expectedAmount: money("expected_amount").notNull(),
    amountTolerance: money("amount_tolerance").notNull(),
    /** `exact` = a confirmed amount; `average` = the mean of the occurrences. */
    amountMode: domainEnum<AmountMode>("amount_mode").notNull(),
    intervalDays: integer("interval_days").notNull(),
    confidence: doublePrecision().notNull(),
    occurrencesCount: integer("occurrences_count").notNull(),
    firstSeenDate: date("first_seen_date").notNull(),
    lastSeenDate: date("last_seen_date").notNull(),
    nextExpectedDate: date("next_expected_date"),
    status: domainEnum<SeriesStatus>().notNull(),
    includeInForecast: boolean("include_in_forecast").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_recurring_series", columns: [t.id] }),
    index("ix_recurring_series_ledger_id").on(t.ledgerId),
    index("ix_recurring_series_next_expected_date").on(t.nextExpectedDate),
    foreignKey({
      name: "fk_recurring_series_category_id_categories",
      columns: [t.categoryId],
      foreignColumns: [categories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_recurring_series_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_recurring_series_merchant_id_merchants",
      columns: [t.merchantId],
      foreignColumns: [merchants.id],
    }).onDelete("set null"),
    unique("uq_recurring_ledger_signature").on(t.ledgerId, t.signature),
  ],
);

/** No `TimestampMixin`. */
export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: serial().notNull(),
    seriesId: integer("series_id").notNull(),
    transactionId: integer("transaction_id").notNull(),
    occurredOn: date("occurred_on").notNull(),
    amount: money().notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_recurring_occurrences", columns: [t.id] }),
    index("ix_recurring_occurrences_series_id").on(t.seriesId),
    index("ix_recurring_occurrences_transaction_id").on(t.transactionId),
    foreignKey({
      name: "fk_recurring_occurrences_series_id_recurring_series",
      columns: [t.seriesId],
      foreignColumns: [recurringSeries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_recurring_occurrences_transaction_id_transactions",
      columns: [t.transactionId],
      foreignColumns: [transactions.id],
    }).onDelete("cascade"),
    unique("uq_occurrence_series_transaction").on(t.seriesId, t.transactionId),
  ],
);

export type RecurringSeries = typeof recurringSeries.$inferSelect;
export type RecurringOccurrence = typeof recurringOccurrences.$inferSelect;
