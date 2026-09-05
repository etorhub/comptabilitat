/**
 * Actors: qui hi ha a l'altra banda d'una transferencia.
 *
 * Un comerç es on es gasta; un actor es amb qui es mou diners. La mateixa
 * persona et pot fer el lloguer cada mes i tornar-te un sopar dissabte:
 * marcar-la com a «recurrent» convertiria els sopars en previsio de saldo, i
 * no marcar-la deixaria el lloguer fora. Per aixo un actor **mai** no porta
 * categoria per defecte (vegeu `services/classification`): els seus
 * moviments sempre queden pendents de revisar, com qualsevol altre moviment
 * sense comerç.
 *
 * Com els comerços, son per espai i a proposit (`uq_actor_ledger_name`): el
 * mateix nom pot ser un actor diferent a cada espai.
 */

import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { domainEnum, timestamps } from "./columns.ts";
import type { ActorKind } from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { users } from "./users.ts";

export const actors = pgTable(
  "actors",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    kind: domainEnum<ActorKind>().notNull(),
    /** Confirmat per una persona: qui l'ha creat automaticament no ho sap del cert. */
    isConfirmed: boolean("is_confirmed").notNull(),
    /** Pont amb un usuari de l'app, per identificar-lo i aparellar-lo entre espais. */
    userId: integer("user_id"),
    transactionCount: integer("transaction_count").notNull(),
    /** Es una data, no una marca de temps, tot i el nom (com a `merchants`). */
    lastSeenAt: date("last_seen_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_actors", columns: [t.id] }),
    index("ix_actors_ledger_id").on(t.ledgerId),
    index("ix_actors_user_id").on(t.userId),
    foreignKey({
      name: "fk_actors_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_actors_user_id_users",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    unique("uq_actor_ledger_name").on(t.ledgerId, t.normalizedName),
  ],
);

/**
 * Alies coneguts d'un actor. Permet que «MARIA G LOPEZ» i «MARIA GARCIA
 * LOPEZ» siguin el mateix actor sense que la propera sincronitzacio en creï
 * un de nou: la cerca en importar va sempre contra aquesta taula, no contra
 * `actors.normalized_name` directament. Un actor neix amb el seu propi alies.
 */
export const actorAliases = pgTable(
  "actor_aliases",
  {
    id: serial().notNull(),
    actorId: integer("actor_id").notNull(),
    ledgerId: integer("ledger_id").notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_actor_aliases", columns: [t.id] }),
    index("ix_actor_aliases_actor_id").on(t.actorId),
    foreignKey({
      name: "fk_actor_aliases_actor_id_actors",
      columns: [t.actorId],
      foreignColumns: [actors.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_actor_aliases_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    unique("uq_actor_alias_ledger_name").on(t.ledgerId, t.normalizedName),
  ],
);

export type Actor = typeof actors.$inferSelect;
export type NewActor = typeof actors.$inferInsert;
export type ActorAlias = typeof actorAliases.$inferSelect;
