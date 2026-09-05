/**
 * Series recurrents i les seves aparicions.
 *
 * Una serie es un rebut o una subscripcio detectats per la regularitat dels
 * intervals i l'estabilitat de l'import. D'aqui surt la previsio de saldo.
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

import { actors } from "./actors.ts";
import { domainEnum, money, timestamps } from "./columns.ts";
import type { Cadence, SeriesStatus } from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { categories, merchants, transactions } from "./transactions.ts";

export const recurringSeries = pgTable(
  "recurring_series",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    /**
     * Identifica la serie: `categoria|contrapart|sentit`, per exemple
     * `c12|m34|in` o `c12|a56|out` (vegeu `signatura()` a
     * `services/recurring.ts`). Abans nomes era el nom normalitzat del
     * comerç, de manera que reanomenar-lo orfenava la serie; ara son
     * identificadors, no text.
     */
    signature: varchar({ length: 220 }).notNull(),
    label: varchar({ length: 200 }).notNull(),
    merchantId: integer("merchant_id"),
    /** Afegida per la migracio `0002_actors_i_recurrents`. */
    actorId: integer("actor_id"),
    /**
     * Mai nul: des de la migracio `0002_actors_i_recurrents` la categoria es
     * qui decideix si una serie existeix (`categories.is_recurrent`), i
     * esborrar-la ha d'esborrar les seves series (per aixo la FK es CASCADE,
     * no SET NULL com abans).
     */
    categoryId: integer("category_id").notNull(),
    cadence: domainEnum<Cadence>().notNull(),
    expectedAmount: money("expected_amount").notNull(),
    amountTolerance: money("amount_tolerance").notNull(),
    intervalDays: integer("interval_days").notNull(),
    confidence: doublePrecision().notNull(),
    occurrencesCount: integer("occurrences_count").notNull(),
    firstSeenDate: date("first_seen_date").notNull(),
    lastSeenDate: date("last_seen_date").notNull(),
    nextExpectedDate: date("next_expected_date"),
    isSubscription: boolean("is_subscription").notNull(),
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
    foreignKey({
      name: "fk_recurring_series_actor_id_actors",
      columns: [t.actorId],
      foreignColumns: [actors.id],
    }).onDelete("set null"),
    unique("uq_recurring_ledger_signature").on(t.ledgerId, t.signature),
  ],
);

/** Sense `TimestampMixin`. */
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
