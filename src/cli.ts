/**
 * Ordres de manteniment.
 *
 *   bun run src/cli.ts crea-usuari --email a@b.cat --password ... [--admin]
 *   bun run src/cli.ts dona-acces  --email a@b.cat --espai personal --rol admin
 *   bun run src/cli.ts neteja-sessions
 *
 * Equival al `python -m app.cli` d'abans.
 */

import { and, eq } from "drizzle-orm";

import { closeDb, db } from "./db/client.ts";
import {
  ledgers,
  ledgerRoleSchema,
  userLedgerPermissions,
  users,
} from "./db/schema/index.ts";
import { hashPassword, purgeExpiredSessions } from "./lib/auth.ts";
import { omplePerAProves } from "./services/demo.ts";
import { seedLedgers } from "./services/seed.ts";

function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireArg(nom: string): string {
  const value = arg(nom);
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Falta --${nom}`);
  }
  return value;
}

async function creaUsuari(): Promise<void> {
  const email = requireArg("email").toLowerCase();
  const password = requireArg("password");
  const isAdmin = process.argv.includes("--admin");

  if (password.length < 10) {
    throw new Error("La contrasenya ha de tenir 10 carácters o mes");
  }

  const existent = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existent.length > 0) {
    throw new Error(`Ja hi ha un usuari amb el correu ${email}`);
  }

  const [creat] = await db
    .insert(users)
    .values({
      email,
      fullName: arg("nom") ?? "",
      passwordHash: await hashPassword(password),
      isAdmin,
      isActive: true,
    })
    .returning({ id: users.id });

  console.log(`Usuari ${email} creat (id ${creat?.id})${isAdmin ? ", administrador" : ""}.`);
  if (isAdmin) {
    console.log("Recorda: ser administrador no dona acces a cap espai. Fes servir dona-acces.");
  }
}

async function donaAcces(): Promise<void> {
  const email = requireArg("email").toLowerCase();
  const codi = requireArg("espai");
  const rol = ledgerRoleSchema.parse(arg("rol") ?? "viewer");

  const [usuari] = await db.select().from(users).where(eq(users.email, email));
  if (!usuari) throw new Error(`No hi ha cap usuari amb el correu ${email}`);

  const [espai] = await db.select().from(ledgers).where(eq(ledgers.code, codi));
  if (!espai) throw new Error(`No hi ha cap espai amb el codi ${codi}`);

  const [ja] = await db
    .select({ id: userLedgerPermissions.id })
    .from(userLedgerPermissions)
    .where(
      and(
        eq(userLedgerPermissions.userId, usuari.id),
        eq(userLedgerPermissions.ledgerId, espai.id),
      ),
    );

  if (ja) {
    await db
      .update(userLedgerPermissions)
      .set({ role: rol })
      .where(eq(userLedgerPermissions.id, ja.id));
    console.log(`${email} ara es ${rol} a ${espai.name}.`);
  } else {
    await db
      .insert(userLedgerPermissions)
      .values({ userId: usuari.id, ledgerId: espai.id, role: rol });
    console.log(`${email} te acces a ${espai.name} com a ${rol}.`);
  }
}

async function netejaSessions(): Promise<void> {
  const n = await purgeExpiredSessions();
  console.log(`${n} sessions caducades esborrades.`);
}

/** Crea els tres espais i el seu pla de categories, si no hi son. */
async function inicia(): Promise<void> {
  const creats = await seedLedgers();
  console.log(
    creats.length > 0
      ? `Espais creats: ${creats.map((e) => e.code).join(", ")}.`
      : "Els espais ja hi eren; s'ha comprovat el pla de categories.",
  );
}

/** Divuit mesos de moviments d'exemple. No fa res si ja hi ha dades. */
async function demo(): Promise<void> {
  if (process.env.ENVIRONMENT === "production" && !process.argv.includes("--force")) {
    throw new Error("Aixo es produccio. Si de debò ho vols, torna-ho a provar amb --force.");
  }
  const resum = await omplePerAProves(
    arg("email") ?? "demo@exemple.cat",
    arg("password") ?? "comptabilitat",
  );
  console.log(JSON.stringify(resum, null, 2));
}

const ordres: Record<string, () => Promise<void>> = {
  init: inicia,
  demo,
  "crea-usuari": creaUsuari,
  "dona-acces": donaAcces,
  "neteja-sessions": netejaSessions,
};

const ordre = process.argv[2];
const funcio = ordre === undefined ? undefined : ordres[ordre];

if (funcio === undefined) {
  console.error(`Ordres: ${Object.keys(ordres).join(", ")}`);
  process.exit(1);
}

try {
  await funcio();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
