import { defineConfig } from "drizzle-kit";

/**
 * Alembic ha estat l'autoritat de les migracions fins al cap `b2c3d4e5f6a7`.
 * A partir del canvi de pila, `drizzle-kit` pren el relleu amb aquell estat
 * com a base: l'esquema de `src/db/schema` ha de descriure la base de dades
 * viva exactament, de manera que el primer `generate` no produeixi cap DDL.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://comptabilitat:comptabilitat@127.0.0.1:5432/comptabilitat",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
