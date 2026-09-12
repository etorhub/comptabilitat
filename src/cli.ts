/**
 * Maintenance commands.
 *
 * The command names and their flags stay Catalan: they are the operator's
 * interface, like the URLs.
 *
 *   bun run src/cli.ts crea-espai  --codi nou --nom "Nom de l'espai" [--color #7c3aed]
 *   bun run src/cli.ts crea-usuari --email a@b.cat --password ... [--admin]
 *   bun run src/cli.ts dona-acces  --email a@b.cat --espai personal --rol admin
 *   bun run src/cli.ts neteja-sessions
 *
 * The equivalent of the old `python -m app.cli`.
 */

import { and, desc, eq } from "drizzle-orm";

import { closeDb, db } from "./db/client.ts";
import { ledgers, ledgerRoleSchema, userLedgerPermissions, users } from "./db/schema/index.ts";
import { hashPassword, purgeExpiredSessions } from "./lib/auth.ts";
import { workspaceCreateSchema } from "./routes/workspaces/workspaces.schema.ts";
import { seedCategories } from "./services/seed.ts";
import { fillForTests } from "./services/demo.ts";
import { seedLedgers } from "./services/seed.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Falta --${name}`);
  }
  return value;
}

async function createUser(): Promise<void> {
  const email = requireArg("email").toLowerCase();
  const password = requireArg("password");
  const isAdmin = process.argv.includes("--admin");

  if (password.length < 10) {
    throw new Error("La contrasenya ha de tenir 10 carácters o mes");
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    throw new Error(`Ja hi ha un usuari amb el correu ${email}`);
  }

  const [createdOne] = await db
    .insert(users)
    .values({
      email,
      fullName: arg("nom") ?? "",
      passwordHash: await hashPassword(password),
      isAdmin,
      isActive: true,
    })
    .returning({ id: users.id });

  console.log(
    `Usuari ${email} creat (id ${createdOne?.id})${isAdmin ? ", administrador" : ""}.`,
  );
  if (isAdmin) {
    console.log("Recorda: ser administrador no dona acces a cap espai. Fes servir dona-acces.");
  }
}

async function grantsAccess(): Promise<void> {
  const email = requireArg("email").toLowerCase();
  const code = requireArg("espai");
  const role = ledgerRoleSchema.parse(arg("rol") ?? "viewer");

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No hi ha cap usuari amb el correu ${email}`);

  const [workspace] = await db.select().from(ledgers).where(eq(ledgers.code, code));
  if (!workspace) throw new Error(`No hi ha cap espai amb el codi ${code}`);

  const [ja] = await db
    .select({ id: userLedgerPermissions.id })
    .from(userLedgerPermissions)
    .where(
      and(
        eq(userLedgerPermissions.userId, user.id),
        eq(userLedgerPermissions.ledgerId, workspace.id),
      ),
    );

  if (ja) {
    await db
      .update(userLedgerPermissions)
      .set({ role: role })
      .where(eq(userLedgerPermissions.id, ja.id));
    console.log(`${email} ara es ${role} a ${workspace.name}.`);
  } else {
    await db
      .insert(userLedgerPermissions)
      .values({ userId: user.id, ledgerId: workspace.id, role: role });
    console.log(`${email} te acces a ${workspace.name} com a ${role}.`);
  }
}

/**
 * A new workspace, with its whole category plan.
 *
 * Not done from the interface: creating a workspace is a one-off and building
 * a screen for it does not pay. Access is granted afterwards with
 * `dona-acces`.
 */
async function createWorkspace(): Promise<void> {
  const data = workspaceCreateSchema.parse({
    code: requireArg("codi"),
    name: requireArg("nom"),
    description: arg("descripcio") ?? "",
    color: arg("color") ?? "#7c3aed",
  });

  const [ja] = await db
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(eq(ledgers.code, data.code));
  if (ja) throw new Error(`Ja hi ha un espai amb el codi ${data.code}`);

  const [last] = await db
    .select({ position: ledgers.position })
    .from(ledgers)
    .orderBy(desc(ledgers.position))
    .limit(1);

  const [createdOne] = await db
    .insert(ledgers)
    .values({
      code: data.code,
      name: data.name,
      description: data.description,
      currency: "EUR",
      color: data.color,
      overdraftThreshold: "0.00",
      position: (last?.position ?? -1) + 1,
      isActive: true,
      alertRecipients: [],
    })
    .returning();

  const categories = await seedCategories(createdOne?.id ?? 0);
  console.log(`Espai ${data.code} creat amb ${categories} categories.`);
  console.log(
    "La resta (llindar de descobert, destinataris dels avisos) es configura des de " +
      `/e/${data.code}/configuracio.`,
  );
  console.log(
    `Dona-hi acces: bun run cli dona-acces --email tu@example.com --espai ${data.code} --rol admin`,
  );
}

async function cleanSessions(): Promise<void> {
  const n = await purgeExpiredSessions();
  console.log(`${n} sessions caducades esborrades.`);
}

/** Creates the three workspaces and their category plans, if absent. */
async function initialize(): Promise<void> {
  const created = await seedLedgers();
  console.log(
    created.length > 0
      ? `Espais creats: ${created.map((e) => e.code).join(", ")}.`
      : "Els espais ja hi eren; s'ha comprovat el pla de categories.",
  );
}

/** Eighteen months of sample transactions. Does nothing if there is data. */
async function demo(): Promise<void> {
  if (process.env.ENVIRONMENT === "production" && !process.argv.includes("--force")) {
    throw new Error("Aixo es produccio. Si de debò ho vols, torna-ho a provar amb --force.");
  }
  const summary = await fillForTests(
    arg("email") ?? "demo@exemple.cat",
    arg("password") ?? "comptabilitat",
  );
  console.log(JSON.stringify(summary, null, 2));
}

const orders: Record<string, () => Promise<void>> = {
  init: initialize,
  demo,
  "crea-espai": createWorkspace,
  "crea-usuari": createUser,
  "dona-acces": grantsAccess,
  "neteja-sessions": cleanSessions,
};

// Migrations run here too: `init` and `demo` are used against a freshly
// created database where there are no tables yet. If they are already there,
// this does nothing.
if (process.env.SKIP_MIGRATIONS !== "true") {
  const { applyMigrations } = await import("./db/migrate.ts");
  await applyMigrations();
}

const order = process.argv[2];
const fn = order === undefined ? undefined : orders[order];

if (fn === undefined) {
  console.error(`Ordres: ${Object.keys(orders).join(", ")}`);
  process.exit(1);
}

try {
  await fn();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
