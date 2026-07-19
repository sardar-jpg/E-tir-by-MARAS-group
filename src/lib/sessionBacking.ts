/**
 * sessionBacking.ts — stale-session invalidation decisions (Stage 2 PR 4).
 *
 * Session tokens are stateless HMAC payloads with a 24h TTL, so before
 * this module a deleted, disabled, or rejected account kept working until
 * its token expired. attachSession (server.ts) now loads the backing
 * account on every authenticated request and consults this pure decision:
 * a session whose backing account is gone, blocked, or whose adminType no
 * longer matches its stale claims is treated as unauthenticated (the
 * request then gets the ordinary 401 from requireAuth). Nothing here ever
 * creates or mutates an account from session data.
 *
 * The env-configured protected owner has no Firestore record — an admin
 * session whose id IS the owner email is valid without a lookup.
 */
import { isDriverApproved } from "./driverAccess";
import { isClientAccountActive } from "./clientAccess";

export type SessionBackingRejection = "missing" | "blocked" | "role_changed" | "unknown_role";

/**
 * PR #137 review: when the backing-account lookup itself FAILS (Firestore
 * outage), the request is neither authorized nor proven unauthorized —
 * protected routes answer 503 with this code instead of attaching the
 * session (fail-closed) or lying with a 401. Public/unauthenticated
 * routes are unaffected (they never consult the session).
 */
export const SESSION_VERIFICATION_UNAVAILABLE_CODE = "SESSION_VERIFICATION_UNAVAILABLE";
export const SESSION_VERIFICATION_UNAVAILABLE_MESSAGE =
  "Session verification is temporarily unavailable. Please try again in a moment.";

export interface SessionBackingResult {
  ok: boolean;
  reason?: SessionBackingRejection;
}

export interface SessionLike {
  role?: string;
  id?: string;
  adminType?: string;
}

/** True when this admin session is the env-configured owner (no Firestore doc exists for it). */
export function isOwnerSession(session: SessionLike, ownerEmail: string): boolean {
  return (
    session.role === "admin" &&
    !!session.id &&
    !!ownerEmail &&
    session.id.trim().toLowerCase() === ownerEmail.trim().toLowerCase()
  );
}

/** Which collection backs a session role; null = no known backing (reject). */
export function backingCollectionForRole(role: string | undefined): "admins" | "drivers" | "clients" | null {
  if (role === "admin") return "admins";
  if (role === "driver") return "drivers";
  if (role === "client") return "clients";
  return null;
}

/**
 * The decision. `record` is the backing document's data (undefined when it
 * doesn't exist). Rules:
 *  - admin: document must exist, and its CURRENT adminType must equal the
 *    session's claimed adminType — a demoted/promoted admin cannot keep
 *    using stale elevated (or outdated) claims; they must log in again.
 *  - driver: document must exist and be approved (legacy no-status
 *    records count as approved — same rule as login, isDriverApproved).
 *  - client: document must exist and be active (active === false blocks;
 *    undefined/true allowed — same rule as login, isClientAccountActive).
 */
export function evaluateSessionBacking(
  session: SessionLike,
  backing: { exists: boolean; record?: Record<string, unknown> }
): SessionBackingResult {
  const role = session.role;
  if (!backingCollectionForRole(role)) return { ok: false, reason: "unknown_role" };
  if (!backing.exists || !backing.record) return { ok: false, reason: "missing" };

  if (role === "admin") {
    const currentType = (backing.record as { adminType?: string }).adminType;
    if (currentType !== session.adminType) return { ok: false, reason: "role_changed" };
    return { ok: true };
  }
  if (role === "driver") {
    return isDriverApproved(backing.record as { status?: "pending" | "approved" | "rejected" })
      ? { ok: true }
      : { ok: false, reason: "blocked" };
  }
  // client (Owner or Staff — both live in `clients`)
  return isClientAccountActive(backing.record as { active?: boolean })
    ? { ok: true }
    : { ok: false, reason: "blocked" };
}
