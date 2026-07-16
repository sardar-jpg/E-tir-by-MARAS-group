// Shipment-update lost-update race fix (stability audit, PR #111 review).
//
// PUT /api/shipments/:id used to run its post-commit side effects
// (driver-stat bumps, notifications, customer-watcher updates, audit
// logging) inside the SAME try block as the authoritative Firestore
// transaction. If any of those side effects threw, the route fell into
// its outer catch and answered 500 "Failed to update shipment details" —
// even though the shipment had already been committed. An admin seeing
// that 500 could reasonably retry the save, only to get a 409 revision
// conflict against their own already-successful write.
//
// A committed write must never be reported as a failure because a
// non-authoritative side effect (notification, watcher email, audit log,
// a cached driver counter) failed afterward. This module runs those side
// effects independently of each other and never throws — the caller
// always still responds with the committed shipment; failures are
// returned (not swallowed) so the caller can log them with full context.

export interface ShipmentSideEffectTask {
  /** Short, stable, log-friendly identifier — e.g. "customer-watcher-notification". */
  name: string;
  run: () => Promise<void>;
}

export interface ShipmentSideEffectFailure {
  name: string;
  error: unknown;
}

/**
 * Runs every task to completion regardless of whether earlier ones threw,
 * via Promise.allSettled — one failing notification must not prevent the
 * audit log (or any other independent side effect) from still running.
 * Returns the failures (empty array if all succeeded) instead of logging
 * them itself, so this stays a small, pure, easily-testable unit; the
 * caller (server.ts) is responsible for logging with shipment-specific
 * context and must never let a failure here change the HTTP response.
 */
export async function runShipmentUpdateSideEffects(
  tasks: ShipmentSideEffectTask[]
): Promise<ShipmentSideEffectFailure[]> {
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const failures: ShipmentSideEffectFailure[] = [];
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      failures.push({ name: tasks[i].name, error: result.reason });
    }
  });
  return failures;
}
