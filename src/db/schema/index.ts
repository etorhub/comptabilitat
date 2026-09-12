/**
 * The database schema.
 *
 * It describes **exactly** the database that already exists: until the stack
 * change Alembic ran the migrations, and its last head is `b2c3d4e5f6a7`. The
 * proof that this is true is that `bun run db:generate` must propose no DDL.
 * If it proposes any, what is wrong is this schema, not the database.
 *
 * The files follow `backend/app/models/`'s split, not `src/routes/`'s: they go
 * by aggregate, because foreign keys cross between tables the interface treats
 * as separate resources.
 */

export * from "./alerts.ts";
export * from "./banking.ts";
export * from "./columns.ts";
export * from "./enums.ts";
export * from "./jobs.ts";
export * from "./ledgers.ts";
export * from "./recurring.ts";
export * from "./transactions.ts";
export * from "./users.ts";
