/**
 * Peces de columna compartides, equivalents a `backend/app/models/base.py`.
 *
 * Dues coses que no s'han de tocar sense pensar-hi:
 *
 * - Els diners son sempre `numeric(14,2)`, mai coma flotant. Drizzle els
 *   retorna com a `string` i han de continuar sent-ho fins a `lib/money`.
 * - `updatedAt` s'actualitza des del client (`$onUpdate`), com feia el
 *   `onupdate` de SQLAlchemy. A la base de dades no hi ha cap disparador.
 */

import { numeric, timestamp, varchar } from "drizzle-orm/pg-core";

/** Import monetari: `numeric(14,2)`, sempre `string` a la banda de TypeScript. */
export const money = (name?: string) =>
  name
    ? numeric(name, { precision: 14, scale: 2 })
    : numeric({ precision: 14, scale: 2 });

/**
 * Enumeracio del domini: `varchar(32)` amb el tipus estret des de TypeScript.
 * La base de dades no en comprova el valor (no hi ha CHECK), de manera que
 * el tipus i el Zod corresponent son l'unica xarxa.
 */
export const domainEnum = <T extends string>(name?: string) =>
  (name ? varchar(name, { length: 32 }) : varchar({ length: 32 })).$type<T>();

/**
 * `created_at` / `updated_at` amb `DEFAULT now()` a la base de dades.
 * Nomes les taules que el Python marcava amb `TimestampMixin` el porten;
 * `user_sessions`, `balances`, `sync_runs`, `llm_suggestions` i
 * `recurring_occurrences` **no**, i per aixo no fan servir aixo.
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

/** Marca de temps amb zona, sense cap valor per defecte a la base de dades. */
export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
