/**
 * Usuaris i sessions.
 *
 * De la sessio, a la base de dades nomes hi ha el **resum** del testimoni
 * (`token_hash`), mai el testimoni en clar: qui llegeixi la taula no pot
 * suplantar ningu.
 */

import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps, tz } from "./columns.ts";

export const users = pgTable(
  "users",
  {
    id: serial().notNull(),
    email: varchar({ length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    /** argon2id. Mai surt d'aqui ni arriba a cap plantilla. */
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    /** Administrador de la instal·lacio: gestiona bancs i usuaris. */
    isAdmin: boolean("is_admin").notNull(),
    isActive: boolean("is_active").notNull(),
    lastLoginAt: tz("last_login_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_users", columns: [t.id] }),
    uniqueIndex("ix_users_email").on(t.email),
  ],
);

/**
 * Aquesta taula no porta `TimestampMixin`: `created_at` no te cap valor per
 * defecte a la base de dades i l'ha de posar qui insereix.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: serial().notNull(),
    userId: integer("user_id").notNull(),
    /** SHA-256 del testimoni de la galeta, en hexadecimal. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull(),
    /** S'escriu com a molt un cop cada 300 s, per no fer un UPDATE per peticio. */
    lastSeenAt: tz("last_seen_at").notNull(),
    userAgent: varchar("user_agent", { length: 255 }).notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_user_sessions", columns: [t.id] }),
    uniqueIndex("ix_user_sessions_token_hash").on(t.tokenHash),
    index("ix_user_sessions_user_id").on(t.userId),
    foreignKey({
      name: "fk_user_sessions_user_id_users",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
