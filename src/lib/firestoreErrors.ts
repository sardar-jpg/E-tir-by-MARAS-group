/**
 * firestoreErrors.ts
 *
 * Phase 2A follow-up (Firestore scalability audit, shipments/orders —
 * blocking-issue fix). Every existing Firestore query wrapper in
 * server.ts (getDoc/getDocs/setDoc/... and the newer queryDescendingPage/
 * queryAscendingSince/findShipmentByShareToken this PR added) treats ANY
 * caught error the same way: flip the process-wide `useMemoryFallback`
 * flag and schedule a 30s recovery attempt. That's the right response to
 * a genuine connectivity problem (Firestore unreachable, auth failure,
 * timeout) — it is the WRONG response to a missing/still-building
 * composite index, which is a property of one specific query shape, not
 * of Firestore's availability. This PR ships 6 new composite indexes
 * (firestore.indexes.json) that are NOT deployed by this PR — if backend
 * code reaches production before those indexes finish building, every
 * shipments-list/since-poll/share-token request would throw a
 * FAILED_PRECONDITION "the query requires an index" error. Without this
 * distinction, that one missing index would silently degrade EVERY
 * Firestore-backed endpoint in the whole process to the (empty, in
 * production) in-memory store for 30 seconds at a time, repeatedly, for
 * as long as the index keeps building — a much larger blast radius than
 * the one query that's actually missing its index.
 *
 * isMissingIndexError lets the shipments query helpers (server.ts)
 * special-case this: under STRICT_PERSISTENCE, throw a 503 for just that
 * one request with a clear log identifying it as an index problem, never
 * touching the global fallback flag; outside STRICT_PERSISTENCE (local
 * dev), serve that one call from memory without flipping the global flag
 * either, since there is nothing "down" to recover from.
 *
 * Firebase Admin SDK / gRPC error shape: a missing-index error is
 * FAILED_PRECONDITION (gRPC status code 9), with a message containing
 * "requires an index" and (usually) a Firebase Console URL to create it.
 * Checked defensively across both `.code` (numeric gRPC code OR the
 * string "failed-precondition" some SDK versions use) and `.message`,
 * since exact error shape has changed across firebase-admin versions and
 * this must not silently stop matching after a dependency bump.
 */
export function isMissingIndexError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";
  const mentionsIndex = message.includes("requires an index") || message.includes("index is currently building") || message.includes("no matching index found");
  if (mentionsIndex) return true;
  const isFailedPrecondition = err.code === 9 || err.code === "failed-precondition" || err.code === "FAILED_PRECONDITION";
  return isFailedPrecondition && message.includes("index");
}
