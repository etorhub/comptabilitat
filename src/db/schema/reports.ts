/**
 * The reports the local model writes: the morning brief and the monthly one.
 *
 * One row per workspace, kind and period. The figures (`facts`) are computed
 * by `services/report-facts.ts`, never by the model: the model only turns them
 * into prose (`text`). Both are stored so the page draws exactly what the
 * model was shown. Nothing here carries `transactions.raw` or an IBAN.
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
import type { AiReportKind, AiReportStatus } from "./enums.ts";
import { ledgers } from "./ledgers.ts";

export const aiReports = pgTable(
  "ai_reports",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    kind: domainEnum<AiReportKind>().notNull(),
    /** `2026-09` for a monthly report, `2026-09-27` for a daily brief. */
    period: varchar({ length: 10 }).notNull(),
    status: domainEnum<AiReportStatus>().notNull(),
    /** The computed figures, amounts as `MoneyString`. Null until computed. */
    facts: jsonb().$type<Record<string, unknown>>(),
    /** What the model wrote: `{ resum, punts }`. Null until it has. */
    text: jsonb().$type<{ resum: string; punts: string[] }>(),
    model: varchar({ length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 20 }).notNull(),
    /** Why the last attempt failed, in Catalan; empty when it did not. */
    error: text().notNull(),
    /** Failed scheduled attempts, so the catch-up gives up at some point. */
    attempts: integer().notNull(),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_ai_reports", columns: [t.id] }),
    index("ix_ai_reports_ledger_id").on(t.ledgerId),
    index("ix_ai_reports_status").on(t.status),
    unique("uq_ai_reports_ledger_kind_period").on(t.ledgerId, t.kind, t.period),
    foreignKey({
      name: "fk_ai_reports_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
  ],
);

export type AiReport = typeof aiReports.$inferSelect;
