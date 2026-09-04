/**
 * Connexio a PostgreSQL.
 *
 * Una sola piscina per proces, com feia `app/db.py`. El servidor web i el
 * planificador son processos separats i cadascun te la seva.
 */

import { drizzle } from "drizzle-orm/postgres-js";
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

/** Tanca la piscina. Nomes per a scripts i proves. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
