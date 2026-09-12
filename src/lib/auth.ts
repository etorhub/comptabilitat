/**
 * Sessions and passwords.
 *
 * The same model as `app/core/security.py` had, plus two things that were not
 * there before and are not a whim:
 *
 *   1. **CSRF** (in `lib/csrf.ts`). The previous application had no defence at
 *      all: only `SameSite=Lax` and the CORS origin list.
 *   2. **A login attempt limit.** There was none of that either.
 *
 * Of the session token, only the SHA-256 digest reaches the database.
 */

import { and, eq, lt, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { userSessions, users, type User } from "../db/schema/index.ts";
import { config } from "./config.ts";

/** The token digest as it is stored. Never the token itself. */
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** A fresh session token. 48 bytes, like `secrets.token_urlsafe(48)`. */
export function newSessionToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// --- Passwords -------------------------------------------------------------

/**
 * argon2id with the same moderate parameters Python used: this runs on a NAS
 * with an N100, not on a server with a graphics card.
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
 * Checks the password. Swallows any digest-format error and returns false, as
 * Python did: a corrupted digest should not become an exception halfway
 * through a request.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/**
 * A throwaway digest, so the same time is spent when the user does not exist.
 * Without it, the response time tells you whether an address is registered.
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
 * Resolves a token's session. Returns `null` when it does not exist, has
 * expired, or the user is deactivated.
 *
 * `last_seen_at` is only written when more than 300 s have passed, to avoid an
 * UPDATE on every request.
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

/** Every session of a user. For when an account is deactivated or deleted. */
export async function destroyAllSessions(userId: number): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

/**
 * Closes **the other** sessions and keeps this one.
 *
 * This is what changing your password does: whoever just changed it should not
 * be locked out, but every other device should. Keeping the current session
 * also keeps the CSRF token already rendered on the page valid, since it
 * derives from the session.
 */
export async function destroyOtherSessions(
  userId: number,
  keepTokenHash: string,
): Promise<number> {
  const deleted = await db
    .delete(userSessions)
    .where(and(eq(userSessions.userId, userId), ne(userSessions.tokenHash, keepTokenHash)))
    .returning({ id: userSessions.id });
  return deleted.length;
}

/**
 * Deletes expired sessions. Python never did, and the table grew for ever; the
 * scheduled maintenance job does it now.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(userSessions)
    .where(lt(userSessions.expiresAt, new Date()))
    .returning({ id: userSessions.id });
  return deleted.length;
}

// --- Login attempt limit ---------------------------------------------------

/**
 * An in-memory counter, on purpose: this is a single-machine installation, and
 * putting it in the database would mean a write on every failed attempt, which
 * is exactly what somebody guessing passwords wants.
 *
 * It counts per address **and** per IP, so neither trying many passwords
 * against one account nor trying one account from many addresses gets through.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

interface Attempt {
  count: number;
  firstAt: number;
}

const attempts = new Map<string, Attempt>();

function purgeOldAttempts(now: number): void {
  for (const [key, attempt] of attempts) {
    if (now - attempt.firstAt > WINDOW_MS) attempts.delete(key);
  }
}

export function loginBlocked(email: string, ip: string): boolean {
  const now = Date.now();
  purgeOldAttempts(now);
  return [`e:${email.toLowerCase()}`, `i:${ip}`].some((key) => {
    const attempt = attempts.get(key);
    return attempt !== undefined && attempt.count >= MAX_ATTEMPTS;
  });
}

export function recordFailedLogin(email: string, ip: string): void {
  const now = Date.now();
  for (const key of [`e:${email.toLowerCase()}`, `i:${ip}`]) {
    const attempt = attempts.get(key);
    if (attempt === undefined || now - attempt.firstAt > WINDOW_MS) {
      attempts.set(key, { count: 1, firstAt: now });
    } else {
      attempt.count += 1;
    }
  }
}

export function clearFailedLogins(email: string, ip: string): void {
  attempts.delete(`e:${email.toLowerCase()}`);
  attempts.delete(`i:${ip}`);
}

// --- Permissions -----------------------------------------------------------

export async function isMemberOfAny(userId: number): Promise<boolean> {
  const { userLedgerPermissions } = await import("../db/schema/index.ts");
  const rows = await db
    .select({ id: userLedgerPermissions.id })
    .from(userLedgerPermissions)
    .where(and(eq(userLedgerPermissions.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
