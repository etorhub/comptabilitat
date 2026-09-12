/**
 * The PostgreSQL connection.
 *
 * One pool per process, as `app/db.py` had. The web server and the scheduler
 * are separate processes and each has its own.
 */

import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { config } from "../lib/config.ts";
import * as schema from "./schema/index.ts";

/**
 * `max: 10` covers the 5 connections + 5 overflow the SQLAlchemy pool had.
 * `prepare: false` is not needed here because there is no PgBouncer in the
 * middle, but the pool is kept small on purpose: this runs on a NAS.
 */
const client = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(client, { schema, casing: "snake_case" });

export type Db = typeof db;

/**
 * The pool **or** a transaction in progress.
 *
 * This is the type every writing function should ask for, so its caller can
 * put it inside a `db.transaction()` of their own.
 *
 * The `Db` above will not do: `drizzle()` returns
 * `PostgresJsDatabase & { $client }`, while the `tx` that `db.transaction()`
 * hands you is a `PgTransaction`, which has no `$client` and therefore does
 * not fit. Both, however, extend `PgDatabase`, which is what is here. While
 * this was `typeof db`, the connection parameter of half a dozen services was
 * decorative: there was no way to pass a transaction into it, which is why
 * `deleteCategory()` had to write every query by hand instead of reusing the
 * helpers that already existed.
 */
export type Transactor = PgDatabase<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Closes the pool. Only for scripts and tests. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
