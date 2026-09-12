/**
 * Shared column pieces, the equivalent of `backend/app/models/base.py`.
 *
 * Two things not to touch without thinking:
 *
 * - Money is always `numeric(14,2)`, never floating point. Drizzle returns it
 *   as a `string` and it has to stay one until `lib/money`.
 * - `updatedAt` is set from the client (`$onUpdate`), as SQLAlchemy's
 *   `onupdate` did. There is no trigger in the database.
 */

import { numeric, timestamp, varchar } from "drizzle-orm/pg-core";

/** A monetary amount: `numeric(14,2)`, always a `string` on the TypeScript side. */
export const money = (name?: string) =>
  name ? numeric(name, { precision: 14, scale: 2 }) : numeric({ precision: 14, scale: 2 });

/**
 * A domain enum: `varchar(32)` with the type narrowed from TypeScript. The
 * database does not check the value (there is no CHECK), so the type and the
 * matching Zod schema are the only safety net.
 */
export const domainEnum = <T extends string>(name?: string) =>
  (name ? varchar(name, { length: 32 }) : varchar({ length: 32 })).$type<T>();

/**
 * `created_at` / `updated_at` with `DEFAULT now()` in the database. Only the
 * tables Python marked with `TimestampMixin` carry it; `user_sessions`,
 * `balances`, `sync_runs`, `llm_suggestions` and `recurring_occurrences` do
 * **not**, which is why they do not use this.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

/** A timestamp with zone, with no default in the database. */
export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
