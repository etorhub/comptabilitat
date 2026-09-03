/**
 * Sessions i contrasenyes.
 *
 * Es el mateix model que hi havia a `app/core/security.py`, amb dues coses
 * afegides que abans no hi eren i que no son un caprici:
 *
 *   1. **CSRF** (a `lib/csrf.ts`). L'aplicacio anterior no en tenia cap
 *      defensa: nomes `SameSite=Lax` i la llista d'origens de CORS.
 *   2. **Limit d'intents d'entrada.** Tampoc no n'hi havia.
 *
 * Del testimoni de sessio, a la base de dades nomes hi ha el resum SHA-256.
 */

import { and, eq, lt, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { userSessions, users, type User } from "../db/schema/index.ts";
import { config } from "./config.ts";

/** Resum del testimoni tal com es desa. Mai el testimoni en clar. */
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** Testimoni de sessio nou. 48 bytes, com el `secrets.token_urlsafe(48)`. */
export function newSessionToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// --- Contrasenyes ----------------------------------------------------------

/**
 * argon2id amb els mateixos parametres moderats que tenia el Python: aixo
 * corre en un NAS amb un N100, no en un servidor amb targeta grafica.
 */
const ARGON2 = {
  algorithm: "argon2id",
  memoryCost: 65536, // 64 MiB
  timeCost: 2,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2);
}

/**
 * Comprova la contrasenya. Empassa qualsevol error de format del resum i
 * retorna fals, com feia el Python: un resum corromput no ha de ser una
 * excepcio a mitja peticio.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/**
 * Resum d'usar i llençar per gastar el mateix temps quan l'usuari no existeix.
 * Sense aixo, el temps de resposta diu si un correu esta donat d'alta.
 */
const DUMMY_HASH = await hashPassword("comptabilitat-usuari-inexistent");

export async function burnPasswordTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

// --- Sessions --------------------------------------------------------------

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: number, userAgent: string): Promise<SessionResult> {
  const token = newSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionMaxAgeDays * 86_400_000);

  await db.insert(userSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
    userAgent: userAgent.slice(0, 255),
  });

  return { token, expiresAt };
}

export interface ResolvedSession {
  user: User;
  tokenHash: string;
}

/**
 * Resol la sessio d'un testimoni. Retorna `null` si no existeix, si ha
 * caducat o si l'usuari esta desactivat.
 *
 * `last_seen_at` nomes s'escriu si han passat mes de 300 s, per no fer un
 * UPDATE a cada peticio.
 */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(token);

  const row = await db
    .select({
      sessionId: userSessions.id,
      expiresAt: userSessions.expiresAt,
      lastSeenAt: userSessions.lastSeenAt,
      user: users,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.tokenHash, tokenHash))
    .limit(1);

  const found = row[0];
  if (!found) return null;

  const now = new Date();
  if (found.expiresAt <= now) return null;
  if (!found.user.isActive) return null;

  if (now.getTime() - found.lastSeenAt.getTime() > 300_000) {
    await db
      .update(userSessions)
      .set({ lastSeenAt: now })
      .where(eq(userSessions.id, found.sessionId));
  }

  return { user: found.user, tokenHash };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.tokenHash, hashToken(token)));
}

/** Totes les sessions de l'usuari. Per quan es desactiva o s'esborra un compte. */
export async function destroyAllSessions(userId: number): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

/**
 * Tanca **la resta** de sessions i conserva la d'aqui.
 *
 * Es el que fa canviar-se la contrasenya: qui l'acaba de canviar no ha de
 * quedar fora, pero qualsevol altre aparell si. Conservar la sessio actual
 * tambe manté valid el testimoni CSRF que ja s'ha dibuixat a la pagina, que
 * en depen.
 */
export async function destroyOtherSessions(userId: number, keepTokenHash: string): Promise<number> {
  const deleted = await db
    .delete(userSessions)
    .where(and(eq(userSessions.userId, userId), ne(userSessions.tokenHash, keepTokenHash)))
    .returning({ id: userSessions.id });
  return deleted.length;
}

/**
 * Esborra les sessions caducades. El Python no ho feia mai i la taula creixia
 * per sempre; ara ho fa la feina programada de manteniment.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(userSessions)
    .where(lt(userSessions.expiresAt, new Date()))
    .returning({ id: userSessions.id });
  return deleted.length;
}

// --- Limit d'intents d'entrada ---------------------------------------------

/**
 * Comptador en memoria, a proposit: aixo es una instal·lacio d'una sola
 * maquina i posar-ho a la base de dades voldria dir escriure-hi a cada intent
 * fallit, que es exactament el que vol qui prova contrasenyes.
 *
 * Es compta per correu **i** per adreça, de manera que ni provar moltes
 * contrasenyes d'un compte ni provar un compte des de moltes adreces passa.
 */
const MAX_INTENTS = 10;
const FINESTRA_MS = 15 * 60 * 1000;

interface Intent {
  count: number;
  firstAt: number;
}

const intents = new Map<string, Intent>();

function clauNeta(now: number): void {
  for (const [clau, intent] of intents) {
    if (now - intent.firstAt > FINESTRA_MS) intents.delete(clau);
  }
}

export function loginBlocked(email: string, ip: string): boolean {
  const now = Date.now();
  clauNeta(now);
  return [`e:${email.toLowerCase()}`, `i:${ip}`].some((clau) => {
    const intent = intents.get(clau);
    return intent !== undefined && intent.count >= MAX_INTENTS;
  });
}

export function recordFailedLogin(email: string, ip: string): void {
  const now = Date.now();
  for (const clau of [`e:${email.toLowerCase()}`, `i:${ip}`]) {
    const intent = intents.get(clau);
    if (intent === undefined || now - intent.firstAt > FINESTRA_MS) {
      intents.set(clau, { count: 1, firstAt: now });
    } else {
      intent.count += 1;
    }
  }
}

export function clearFailedLogins(email: string, ip: string): void {
  intents.delete(`e:${email.toLowerCase()}`);
  intents.delete(`i:${ip}`);
}

// --- Permisos --------------------------------------------------------------

export async function isMemberOfAny(userId: number): Promise<boolean> {
  const { userLedgerPermissions } = await import("../db/schema/index.ts");
  const rows = await db
    .select({ id: userLedgerPermissions.id })
    .from(userLedgerPermissions)
    .where(and(eq(userLedgerPermissions.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
