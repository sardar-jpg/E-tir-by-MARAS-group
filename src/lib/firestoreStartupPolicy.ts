/**
 * firestoreStartupPolicy.ts
 *
 * Pure decision for what happens when the STARTUP Firestore connection check
 * (attemptFirestoreConnect / startFirestoreConnection in server.ts) exhausts
 * all of its retries without ever connecting.
 *
 * Before this module existed, server.ts unconditionally treated an exhausted
 * startup connection check as "fall back to memory and keep going" —
 * regardless of STRICT_PERSISTENCE. That silently violated
 * STRICT_PERSISTENCE's own contract (writes fail loudly instead of landing
 * in volatile memory) for the one case it matters most: the server never
 * successfully connected in the first place. STRICT_PERSISTENCE's
 * per-request `if (STRICT_PERSISTENCE) throw new ServiceUnavailableError()`
 * checks scattered through server.ts still correctly cover the *other* case
 * (was connected, then Firestore became unreachable mid-session) — this
 * module only decides the boot-time case, and does not change per-request
 * behavior at all.
 *
 * See docs/REAL_FIREBASE_VERIFICATION.md §4/§11 for the documented,
 * user-facing description of this behavior.
 */

export type FirestoreStartupFailureOutcome =
  | { mode: "fatal-exit"; message: string }
  | { mode: "memory-fallback"; message: string };

/**
 * @param strictPersistence current STRICT_PERSISTENCE setting (on by default;
 *   only the literal string "false" turns it off — see server.ts).
 * @param lastConnectError the most recent attemptFirestoreConnect failure
 *   message, surfaced in the outcome message for operator debugging.
 */
export function resolveFirestoreStartupFailureOutcome(
  strictPersistence: boolean,
  lastConnectError: string
): FirestoreStartupFailureOutcome {
  if (strictPersistence) {
    return {
      mode: "fatal-exit",
      message:
        "Firestore is unreachable after all startup connection attempts and STRICT_PERSISTENCE is on — " +
        "refusing to start in a silently-degraded memory-fallback mode (STRICT_PERSISTENCE's whole purpose is " +
        "to never let real data land in volatile in-memory storage without warning). Fix Application Default " +
        "Credentials (locally: `gcloud auth application-default login`; on Cloud Run: verify the attached " +
        "service account has the Cloud Datastore User role) and restart, or set STRICT_PERSISTENCE=false to " +
        `explicitly allow memory-fallback startup instead. Last connection error: ${lastConnectError}`,
    };
  }
  return {
    mode: "memory-fallback",
    message:
      "All startup connection attempts failed — STRICT_PERSISTENCE is off, so continuing in memory fallback " +
      `(ALL DATA WILL BE LOST ON RESTART until this is resolved). Last connection error: ${lastConnectError}`,
  };
}
