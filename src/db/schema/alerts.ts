/**
 * Alerts.
 *
 * A null `ledgerId` means the alert belongs to no workspace (a failed sync, an
 * expired consent): those go to the general recipients.
 */

import {
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

import { domainEnum, timestamps, tz } from "./columns.ts";
import type { AlertSeverity, AlertStatus, AlertType } from "./enums.ts";
import { ledgers } from "./ledgers.ts";

export const alerts = pgTable(
  "alerts",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id"),
    type: domainEnum<AlertType>().notNull(),
    severity: domainEnum<AlertSeverity>().notNull(),
    status: domainEnum<AlertStatus>().notNull(),
    /**
     * Unique **globally**, not per workspace. The key includes the period, so
     * the same condition does not raise an alert again every day; and since a
     * dismissed alert keeps its row, it does not come back either.
     */
    dedupKey: varchar("dedup_key", { length: 200 }).notNull(),
    title: varchar({ length: 250 }).notNull(),
    body: text().notNull(),
    payload: jsonb().notNull().$type<Record<string, unknown>>(),
    notifiedAt: tz("notified_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_alerts", columns: [t.id] }),
    index("ix_alerts_ledger_id").on(t.ledgerId),
    index("ix_alerts_status").on(t.status),
    index("ix_alerts_type").on(t.type),
    foreignKey({
      name: "fk_alerts_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    unique("uq_alert_dedup_key").on(t.dedupKey),
  ],
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
