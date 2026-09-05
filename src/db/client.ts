/**
 * Connexio a PostgreSQL.
 *
 * Una sola piscina per proces, com feia `app/db.py`. El servidor web i el
 * planificador son processos separats i cadascun te la seva.
 */

import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { config } from "../lib/config.ts";
import * as schema from "./schema/index.ts";

/**
 * `max: 10` cobreix les 5 connexions + 5 de desbordament que tenia la piscina
 * de SQLAlchemy. `prepare: false` no cal aqui perque no hi ha cap PgBouncer
 * al mig, pero deixem la piscina petita a proposit: aixo corre en un NAS.
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
 * La piscina **o** una transaccio en curs.
 *
 * Es el tipus que ha de demanar tota funcio que escrigui, perque el qui la
 * crida pugui ficar-la dins d'un `db.transaction()` seu.
 *
 * No serveix el `Db` de sobre: `drizzle()` retorna
 * `PostgresJsDatabase & { $client }`, i el `tx` que dona `db.transaction()` es
 * un `PgTransaction`, que no te `$client` i per tant no hi encaixa. Tots dos,
 * pero, hereten de `PgDatabase`, que es el que hi ha aqui. Mentre aixo va ser
 * `typeof db`, el parametre `connexio` de mitja dotzena de serveis era
 * decoratiu: no hi havia manera de passar-hi cap transaccio, i per aixo
 * `esborraCategoria()` va haver d'escriure totes les consultes a ma en lloc de
 * reaprofitar els ajudants que ja hi havia.
 */
export type Transactor = PgDatabase<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Tanca la piscina. Nomes per a scripts i proves. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
