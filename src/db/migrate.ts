/**
 * Migrations.
 *
 * This runs at startup, before any request is accepted.
 *
 * THE DELICATE CASE IS THE FIRST TIME. The production database already exists
 * and Alembic built it; Drizzle's `0000` migration **describes that same
 * database**, so running it would mean creating tables that are already there,
 * and blowing up.
 *
 * So when a database is found that is already at Alembic's head
 * (`b2c3d4e5f6a7`) and has no Drizzle history yet, `0000` is marked as
 * **already applied** without running it. From there on, migrations take the
 * normal path.
 *
 * That `0000` and the Alembic schema are the same thing is not an assumption:
 * it is checked by comparing the two `pg_dump`s, and they have to come out
 * identical.
 */

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db } from "./client.ts";

/** Alembic's head at the time of the stack change. */
const CAP_ALEMBIC = "b2c3d4e5f6a7";

async function existeix(table: string): Promise<boolean> {
  const result = await db.execute<{ existeix: boolean }>(
    sql`select to_regclass(${`public.${table}`}) is not null as existeix`,
  );
  return Boolean(result[0]?.existeix);
}

/**
 * Marks the first migration as applied without running it.
 *
 * It writes straight into Drizzle's history table, which is what the migrator
 * would have done had it run it.
 */
async function baseline(reason: string): Promise<void> {
  const journal = await Bun.file("drizzle/meta/_journal.json").json();
  const first = journal.entries?.[0];
  if (!first) throw new Error("No hi ha cap migracio a drizzle/meta/_journal.json");

  const firstSql = await Bun.file(`drizzle/${first.tag}.sql`).text();
  // The migrator identifies each migration by the digest of its SQL.
  const summary = new Bun.CryptoHasher("sha256").update(firstSql).digest("hex");

  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  await db.execute(
    sql`insert into drizzle."__drizzle_migrations" (hash, created_at) values (${summary}, ${first.when})`,
  );

  console.info(
    `[migracions] base de dades existent (${reason}): la migracio ${first.tag} ` +
      "es marca com a aplicada sense executar-la.",
  );
}

export async function applyMigrations(): Promise<void> {
  const teAlembic = await existeix("alembic_version");

  /**
   * Has this been through a Drizzle migration already?
   *
   * What is checked is whether the history has **rows**, not merely whether
   * the table exists: an attempt that broke halfway can leave the table
   * created and empty, and then checking only for existence would skip the
   * baseline and we would try again to create tables that are already there.
   */
  const hasDrizzleHistory = await db
    .execute<{ n: number }>(sql`select count(*)::int as n from drizzle."__drizzle_migrations"`)
    .then((rows) => Number(rows[0]?.n ?? 0) > 0)
    .catch(() => false);

  // The baseline is only taken the first time: if there is Drizzle history
  // already, this database has been through the stack change.
  if (!hasDrizzleHistory) {
    if (teAlembic) {
      const cap = await db
        .execute<{ version_num: string }>(sql`select version_num from alembic_version limit 1`)
        .catch(() => []);
      const versio = cap[0]?.version_num;

      if (versio !== CAP_ALEMBIC) {
        throw new Error(
          `La base de dades esta a la migracio d'Alembic ${versio ?? "desconeguda"} i s'esperava ` +
            `${CAP_ALEMBIC}. Posa-la al dia amb Alembic abans de canviar de pila.`,
        );
      }

      await baseline("ve d'Alembic");
    } else if (await existeix("ledgers")) {
      // The schema is there but nobody who leaves a record put it there —
      // somebody who applied the DDL by hand, say. Take the baseline anyway,
      // which beats blowing up trying to create tables that already exist.
      await baseline("l'esquema ja hi era");
    }
  }

  await migrate(db, { migrationsFolder: "drizzle" });
  console.info("[migracions] al dia.");
}

// Runnable directly, for deployments and for CI: `bun run src/db/migrate.ts`.
if (import.meta.main) {
  const { closeDb } = await import("./client.ts");
  try {
    await applyMigrations();
  } finally {
    await closeDb();
  }
}
