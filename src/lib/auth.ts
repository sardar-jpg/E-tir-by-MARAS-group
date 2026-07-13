/**
 * auth.ts
 *
 * Standalone, testable session-token and password-hashing logic, extracted
 * from server.ts so it can be unit tested without booting the full Express
 * server (which requires live Firebase credentials).
 *
 * server.ts imports and uses these directly — this file has no dependency
 * on Express, Firebase, or any request/response object, only Node's
 * built-in crypto module.
 */
import crypto from "crypto";

/**
 * BUG-10: a known admin's wrong-password login used to return "Incorrect
 * password for admin user." while an unrecognized username/email fell
 * through to a generic message — the difference let an attacker enumerate
 * which emails are admin accounts just by attempting a login and reading
 * which error came back. Every failed /api/login attempt (wrong password,
 * unknown username, or unknown admin identity) must return this exact same
 * message and status code so the response reveals nothing about whether
 * the account exists or what role it has.
 */
export const GENERIC_LOGIN_ERROR = "Invalid username, email, phone, or password";

export type SessionRole = "admin" | "driver" | "client";

export interface SessionPayload {
  role: SessionRole;
  id: string; // admin email, driver id, or client id
  adminType?: string; // 'super' | 'operation' | 'accounts' — admin only
  viewOnly?: boolean; // true for client employee accounts — set server-side from Firestore, never from client input
  issuedAt: number;
  expiresAt: number;
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signSessionToken(payload: SessionPayload, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expectedSig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
    // Constant-time comparison to avoid timing side-channel attacks on the signature check
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload: SessionPayload = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
    if (!payload.expiresAt || Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export const PENDING_FIREBASE_DELETION_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const PENDING_FIREBASE_DELETION_PURPOSE = "finish-firebase-identity-deletion";

export interface PendingFirebaseIdentityDeletionToken {
  purpose: typeof PENDING_FIREBASE_DELETION_PURPOSE;
  driverId: string;
  firebaseUid: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Review follow-up to fix/apple-driver-account-deletion: once
 * DELETE /api/drivers/:id removes the Firestore driver record, its
 * firebaseUid field is gone too, so a later Retry (after the Firebase Auth
 * deletion itself failed) has no record left to read the uid from. This
 * signed, short-lived, single-purpose token is how the server hands that
 * already-verified uid back to the client for exactly one thing — calling
 * POST /api/drivers/finish-firebase-deletion — without ever exposing it as
 * a Driver-object field (see stripFirebaseUid/sanitizeDriver). It reuses
 * the same HMAC scheme as signSessionToken/verifySessionToken but is
 * intentionally a separate function pair: this token must never be
 * accepted as a session token or vice versa (the `purpose` discriminator
 * enforces that on verify).
 */
export function signPendingFirebaseIdentityDeletionToken(
  payload: { driverId: string; firebaseUid: string; issuedAt: number; expiresAt: number },
  secret: string
): string {
  const full: PendingFirebaseIdentityDeletionToken = { ...payload, purpose: PENDING_FIREBASE_DELETION_PURPOSE };
  const body = base64url(JSON.stringify(full));
  const sig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPendingFirebaseIdentityDeletionToken(
  token: string,
  secret: string
): PendingFirebaseIdentityDeletionToken | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expectedSig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
    if (payload?.purpose !== PENDING_FIREBASE_DELETION_PURPOSE) return null;
    if (typeof payload.driverId !== "string" || !payload.driverId) return null;
    if (typeof payload.firebaseUid !== "string" || !payload.firebaseUid) return null;
    if (!payload.expiresAt || Date.now() > payload.expiresAt) return null;
    return payload as PendingFirebaseIdentityDeletionToken;
  } catch {
    return null;
  }
}

/**
 * PBKDF2 password hashing. Stored format: "pbkdf2$<salt-hex>$<hash-hex>".
 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(plain, salt, 100_000, 64, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string | undefined): boolean {
  if (!stored) return false;
  if (!stored.startsWith("pbkdf2$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  const candidateHash = crypto.pbkdf2Sync(plain, salt, 100_000, 64, "sha256").toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * One-time migration path: accounts created before password hashing was
 * added have plaintext passwords stored in Firestore. A successful
 * plaintext match here is immediately re-hashed and written back via
 * `onMigrated`, so each account silently upgrades itself the next time its
 * owner logs in, rather than locking everyone out the moment this deploys.
 */
export async function verifyPasswordWithMigration(
  plain: string,
  stored: string | undefined,
  onMigrated: (newHash: string) => Promise<void>
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    return verifyPassword(plain, stored);
  }
  if (stored === plain) {
    await onMigrated(hashPassword(plain));
    return true;
  }
  return false;
}
