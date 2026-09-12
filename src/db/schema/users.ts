/**
 * Users and sessions.
 *
 * Of the session, the database holds only the token's **digest**
 * (`token_hash`), never the token itself: whoever reads the table cannot
 * impersonate anyone.
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
    /** argon2id. It never leaves here and never reaches a template. */
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    /** Administrator of the installation: manages banks and users. */
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
 * This table carries no `TimestampMixin`: `created_at` has no default in the
 * database and whoever inserts has to set it.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: serial().notNull(),
    userId: integer("user_id").notNull(),
    /** SHA-256 of the cookie's token, in hex. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull(),
    /** Written at most once every 300 s, to avoid an UPDATE per request. */
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
