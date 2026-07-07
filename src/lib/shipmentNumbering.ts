// Shipment number/id formatting plus the pieces needed to allocate the
// underlying sequence number safely under concurrency (BUG-15). The
// visible format itself ("MAR-<year>-<1001+n>") is unchanged from the
// original implementation - only how `n` is handed out changes.

export const SHIPMENT_NUMBER_BASE = 1001;

export function formatShipmentNumber(year: number, sequence: number): string {
  return `MAR-${year}-${SHIPMENT_NUMBER_BASE + sequence}`;
}

export function formatShipmentId(sequence: number): string {
  return `shipment-${SHIPMENT_NUMBER_BASE + sequence}`;
}

export interface ShipmentSequenceCounterDoc {
  count: number;
}

/**
 * Pure read-modify-write step for the Firestore counter document that
 * hands out shipment sequence numbers. Given the counter doc's current
 * value (undefined if it doesn't exist yet) and a one-time bootstrap
 * fallback (the pre-fix shipment count, so numbering continues where the
 * old count-based approach left off instead of restarting at 0), returns
 * the sequence number the caller should use plus the doc to write back.
 *
 * Kept as a plain function - not inline in the transaction callback - so
 * the increment logic itself can be unit tested without a real Firestore
 * transaction. The atomicity guarantee comes from where this is called
 * from (see server.ts's allocateNextShipmentSequence): Firestore's
 * runTransaction() re-runs the whole callback if the counter document
 * changed since it was read, so two concurrent calls can never both
 * compute `current` from the same starting value and successfully commit.
 */
export function nextSequenceFromCounterDoc(
  existing: ShipmentSequenceCounterDoc | undefined,
  bootstrapCount: number
): { current: number; next: ShipmentSequenceCounterDoc } {
  const current = existing ? existing.count : bootstrapCount;
  return { current, next: { count: current + 1 } };
}

/**
 * Synchronous in-memory equivalent of the Firestore counter transaction,
 * used only when Firestore is unreachable and the app is running on the
 * volatile memory-fallback store. next() never awaits anything - reading
 * `count` and incrementing it happen in a single synchronous call - so
 * the Node event loop cannot suspend a call partway through and let a
 * second, concurrent request's call to next() interleave with it. That
 * interleaving is exactly what would let two concurrent requests read the
 * same starting count and hand out a duplicate shipment number; an `async`
 * version with an `await` between the read and the write would reopen
 * that race even in a single-threaded runtime.
 */
export class InMemorySequenceCounter {
  private count: number;

  constructor(initialCount: number) {
    this.count = initialCount;
  }

  next(): number {
    const current = this.count;
    this.count = current + 1;
    return current;
  }
}
