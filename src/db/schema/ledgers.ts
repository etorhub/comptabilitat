/**
 * Workspaces (*espais estancs*, sealed workspaces).
 *
 * Each one is a whole, separate set of books: its own accounts, category plan,
 * merchants, rules and users. There is no view that mixes more than one.
 */

import {
  boolean,
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
import type { LedgerRole } from "./enums.ts";
import { users } from "./users.ts";

export const ledgers = pgTable(
  "ledgers",
  {
    id: serial().notNull(),
    /** The short code in the URL: `personal`, `calella`, `pardals`. */
    code: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    description: varchar({ length: 500 }).notNull(),
    currency: varchar({ length: 3 }).notNull(),
    color: varchar({ length: 9 }).notNull(),
    /** Below this projected balance, the overdraft alert fires. */
    overdraftThreshold: money("overdraft_threshold").notNull(),
    position: integer().notNull(),
    isActive: boolean("is_active").notNull(),
    /** This workspace's alert recipients; when empty, the general ones. */
    alertRecipients: varchar("alert_recipients", { length: 255 }).array().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_ledgers", columns: [t.id] }),
    unique("uq_ledgers_code").on(t.code),
  ],
);

/**
 * A user's access to a workspace. This table is the only source of truth for
 * who gets in: being an administrator of the application (`users.is_admin`)
 * grants **no** workspace access.
 */
export const userLedgerPermissions = pgTable(
  "user_ledger_permissions",
  {
    id: serial().notNull(),
    userId: integer("user_id").notNull(),
    ledgerId: integer("ledger_id").notNull(),
    role: domainEnum<LedgerRole>().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_user_ledger_permissions", columns: [t.id] }),
    index("ix_user_ledger_permissions_ledger_id").on(t.ledgerId),
    index("ix_user_ledger_permissions_user_id").on(t.userId),
    foreignKey({
      name: "fk_user_ledger_permissions_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_user_ledger_permissions_user_id_users",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    unique("uq_user_ledger").on(t.userId, t.ledgerId),
  ],
);

export type Ledger = typeof ledgers.$inferSelect;
export type NewLedger = typeof ledgers.$inferInsert;
export type LedgerPermission = typeof userLedgerPermissions.$inferSelect;
