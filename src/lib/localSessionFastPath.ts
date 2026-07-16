const SESSION_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;
/** Small, deliberate allowance for minor clock drift between the device
 *  that wrote `lastActive` and the device evaluating it now — not a grace
 *  period for stale sessions, just enough to absorb normal clock skew
 *  without treating a slightly-ahead timestamp as "from the future". */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Minimal shape this decision needs — deliberately not the full AppSession
 *  type from App.tsx, so this stays a small, standalone, testable unit. */
export type LocalFastPathSession = {
  role?: string;
  loginType?: string;
  token?: string;
  lastActive?: number;
} | null | undefined;

/**
 * True only for a session the primary /api/login flow already fully
 * established: local, role-bearing, token-bearing, and not yet expired
 * under the existing 24h inactivity rule. Such a session never depended on
 * Firebase Auth in the first place, so the startup screen shouldn't block
 * rendering it behind Firebase's onAuthStateChanged initialization —
 * Firebase-based sessions (loginType "firebase") still go through the
 * normal gate untouched.
 *
 * `isExplicitlyLoggedOut` should be the current `etir_logged_out` flag —
 * checked defensively here even though handleLogout already clears the
 * session whenever it sets that flag, so a fast path can never be taken
 * against an inconsistent/tampered localStorage state.
 */
export function isValidLocalSessionFastPath(
  session: LocalFastPathSession,
  isExplicitlyLoggedOut: boolean,
  now: number = Date.now()
): boolean {
  if (isExplicitlyLoggedOut) return false;
  if (!session) return false;
  if (session.loginType !== "local") return false;
  if (session.role !== "admin" && session.role !== "driver" && session.role !== "client") return false;
  if (typeof session.token !== "string" || session.token.trim() === "") return false;
  if (!Number.isFinite(session.lastActive)) return false;

  const age = now - (session.lastActive as number);
  // A negative age means lastActive is ahead of `now` — only tolerate that
  // within a small clock-skew window; anything further in the future is
  // treated the same as any other invalid timestamp, not as "very fresh".
  if (age < -CLOCK_SKEW_TOLERANCE_MS) return false;
  if (age > SESSION_INACTIVITY_LIMIT_MS) return false;
  return true;
}
