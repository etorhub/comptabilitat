/**
 * Esquema de la base de dades.
 *
 * Descriu **exactament** la base de dades que ja hi ha: fins al canvi de pila
 * les migracions les feia Alembic, i el darrer cap seu es `b2c3d4e5f6a7`.
 * La prova que aixo es cert es que `bun run db:generate` no ha de proposar cap
 * DDL. Si en proposa, el que esta malament es aquest esquema, no la base de
 * dades.
 *
 * Els fitxers segueixen la divisio de `backend/app/models/`, no la de
 * `src/routes/`: van per agregat, perque les claus foranes es creuen entre
 * taules que la interficie tracta com a recursos diferents.
 */

export * from "./alerts.ts";
export * from "./banking.ts";
export * from "./columns.ts";
export * from "./enums.ts";
export * from "./ledgers.ts";
export * from "./recurring.ts";
export * from "./transactions.ts";
export * from "./users.ts";
