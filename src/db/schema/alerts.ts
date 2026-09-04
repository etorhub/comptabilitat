/**
 * Avisos.
 *
 * `ledgerId` nul vol dir que l'avis no es de cap espai (una sincronitzacio
 * fallida, un consentiment caducat): aquests van als destinataris generals.
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
     * Unica **globalment**, no per espai. La clau inclou el periode, de manera
     * que la mateixa condicio no torna a avisar cada dia; i com que un avis
     * descartat conserva la fila, tampoc no ressuscita.
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
