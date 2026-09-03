/**
 * Migracions.
 *
 * Aixo s'executa en arrencar, abans d'acceptar cap peticio.
 *
 * EL CAS DELICAT ES EL PRIMER COP. La base de dades de produccio ja existeix i
 * la va fer Alembic; la migracio `0000` de Drizzle **descriu aquesta mateixa
 * base de dades**, de manera que executar-la voldria dir crear unes taules que
 * ja hi son i petar.
 *
 * Per aixo, quan es troba una base de dades que ja te l'esquema d'Alembic al
 * seu cap (`b2c3d4e5f6a7`) i encara no te historial de Drizzle, la `0000` es
 * marca com a **ja aplicada** sense executar-la. A partir d'aqui, les
 * migracions segueixen el cami normal.
 *
 * Que `0000` i l'esquema d'Alembic son la mateixa cosa no es una suposicio:
 * es comprova comparant els dos `pg_dump`, i han de sortir identics.
 */

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db } from "./client.ts";

/** El cap d'Alembic quan es va canviar de pila. */
const CAP_ALEMBIC = "b2c3d4e5f6a7";

async function existeix(taula: string): Promise<boolean> {
  const resultat = await db.execute<{ existeix: boolean }>(
    sql`select to_regclass(${`public.${taula}`}) is not null as existeix`,
  );
  return Boolean(resultat[0]?.existeix);
}

/**
 * Marca la primera migracio com a aplicada sense executar-la.
 *
 * Es escriu directament a la taula d'historial de Drizzle, que es el mateix
 * que faria el migrador si l'hagues executada.
 */
async function baseline(motiu: string): Promise<void> {
  const journal = await Bun.file("drizzle/meta/_journal.json").json();
  const primera = journal.entries?.[0];
  if (!primera) throw new Error("No hi ha cap migracio a drizzle/meta/_journal.json");

  const sqlPrimera = await Bun.file(`drizzle/${primera.tag}.sql`).text();
  // El migrador identifica cada migracio pel resum del seu SQL.
  const resum = new Bun.CryptoHasher("sha256").update(sqlPrimera).digest("hex");

  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  await db.execute(
    sql`insert into drizzle."__drizzle_migrations" (hash, created_at) values (${resum}, ${primera.when})`,
  );

  console.info(
    `[migracions] base de dades existent (${motiu}): la migracio ${primera.tag} ` +
      "es marca com a aplicada sense executar-la.",
  );
}

export async function aplicaMigracions(): Promise<void> {
  const teAlembic = await existeix("alembic_version");

  /**
   * Ha passat ja per una migracio de Drizzle?
   *
   * Es mira si l'historial te **files**, no nomes si la taula hi es: un intent
   * que ha petat a mitges pot haver deixat la taula creada i buida, i llavors
   * mirar-ne nomes l'existencia faria saltar la base i tornariem a provar de
   * crear unes taules que ja hi son.
   */
  const teHistorialDrizzle = await db
    .execute<{ n: number }>(sql`select count(*)::int as n from drizzle."__drizzle_migrations"`)
    .then((files) => Number(files[0]?.n ?? 0) > 0)
    .catch(() => false);

  // Nomes es fa la base la primera vegada: si ja hi ha historial de Drizzle,
  // aquesta base de dades ja ha passat pel canvi de pila.
  if (!teHistorialDrizzle) {
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
      // L'esquema ja hi es pero no l'ha posat ningu que en deixi constancia:
      // per exemple, algu que ha aplicat el DDL a ma. Es fa la base igual, que
      // es millor que petar intentant crear unes taules que ja hi son.
      await baseline("l'esquema ja hi era");
    }
  }

  await migrate(db, { migrationsFolder: "drizzle" });
  console.info("[migracions] al dia.");
}

// Executable directament, per als desplegaments i per a la integracio
// continua: `bun run src/db/migrate.ts`.
if (import.meta.main) {
  const { closeDb } = await import("./client.ts");
  try {
    await aplicaMigracions();
  } finally {
    await closeDb();
  }
}
