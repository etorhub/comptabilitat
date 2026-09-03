/**
 * Espais de treball (*espais estancs*).
 *
 * Cada espai es una comptabilitat sencera i separada: els seus comptes, el seu
 * pla de categories, els seus comerços, les seves regles i els seus usuaris.
 * No hi ha cap vista que en barregi mes d'un.
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
    /** Codi curt de l'adreça: `personal`, `calella`, `pardals`. */
    code: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    description: varchar({ length: 500 }).notNull(),
    currency: varchar({ length: 3 }).notNull(),
    color: varchar({ length: 9 }).notNull(),
    /** Per sota d'aquest saldo previst salta l'avis de descobert. */
    overdraftThreshold: money("overdraft_threshold").notNull(),
    position: integer().notNull(),
    isActive: boolean("is_active").notNull(),
    /** Destinataris dels avisos d'aquest espai; si es buit, els generals. */
    alertRecipients: varchar("alert_recipients", { length: 255 }).array().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_ledgers", columns: [t.id] }),
    unique("uq_ledgers_code").on(t.code),
  ],
);

/**
 * Acces d'un usuari a un espai. Aquesta taula es l'unica font de veritat de
 * qui hi entra: ser administrador de l'aplicacio (`users.is_admin`) **no**
 * dona acces a cap espai.
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
