// Shipment-update lost-update race (stability audit). PUT /api/shipments/:id
// used to read-modify-write the shipment document with no concurrency
// check at all: two admins editing the same shipment close together could
// have the later write silently overwrite fields the first admin just
// saved, with no error to either of them.
//
// Fixed with optimistic concurrency control: every shipment carries a
// server-owned numeric `revision`. A client may only save the changes it
// made starting from a specific revision it actually read — never a
// revision it invents — and the server increments the stored revision by
// exactly 1 on every successful update. Kept as pure functions (not inline
// in the Firestore transaction callback in server.ts) so the comparison
// logic itself is unit-testable without a real Firestore transaction —
// same rationale, and same relationship to its caller, as
// nextSequenceFromCounterDoc/shipmentNumbering.ts, which this mirrors.

export const INITIAL_SHIPMENT_REVISION = 1;

/**
 * Legacy shipments written before `revision` existed have no such field at
 * all — they are interpreted as revision 1, the same starting point a
 * brand-new shipment gets (POST /api/shipments sets `revision: 1`
 * explicitly). Anything else stored that isn't a positive integer (which
 * should never happen, since only this module's own logic ever writes
 * this field) is treated the same defensive way.
 */
export function resolveStoredRevision(revision: unknown): number {
  if (typeof revision === "number" && Number.isInteger(revision) && revision >= INITIAL_SHIPMENT_REVISION) {
    return revision;
  }
  return INITIAL_SHIPMENT_REVISION;
}

/**
 * Validates a client-submitted `expectedRevision` — the revision number the
 * client read the shipment at, never a value it can use to claim an
 * arbitrary "next" revision. Returns the validated positive integer, or
 * null for anything malformed: not a number, NaN, +/-Infinity, a decimal,
 * zero, or negative. Strings are rejected outright (no numeric coercion) so
 * a caller can't smuggle a technically-numeric-looking value past this
 * check in a form JSON doesn't already represent as a number.
 */
export function parseExpectedRevision(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < INITIAL_SHIPMENT_REVISION) return null;
  return value;
}

export interface ShipmentRevisionCheck {
  ok: boolean;
  /** The document's actual current revision (resolveStoredRevision-adjusted). */
  currentRevision: number;
  /** currentRevision + 1 when ok is true; equal to currentRevision otherwise (unused on conflict). */
  nextRevision: number;
}

/**
 * Pure comparison step for the Firestore transaction that updates a
 * shipment: compares the client's expected revision against the document's
 * actual current revision. Exactly one of two concurrent callers starting
 * from the same expectedRevision can ever see `ok: true` for the same
 * document, because the transaction this runs inside re-reads the document
 * fresh and Firestore aborts/retries the whole callback if it changed
 * since — the same guarantee nextSequenceFromCounterDoc relies on for
 * shipment numbering (see shipmentNumbering.ts).
 */
export function checkShipmentRevision(storedRevision: unknown, expectedRevision: number): ShipmentRevisionCheck {
  const currentRevision = resolveStoredRevision(storedRevision);
  if (currentRevision !== expectedRevision) {
    return { ok: false, currentRevision, nextRevision: currentRevision };
  }
  return { ok: true, currentRevision, nextRevision: currentRevision + 1 };
}

/**
 * Thrown by the transaction callback (server.ts's applyShipmentRevisionedUpdate)
 * when checkShipmentRevision reports a mismatch. Carries what the client
 * needs to recover safely: the real current revision, and the current
 * shipment record so the UI can offer a reload without a second round
 * trip. Deliberately a distinct type from any Firestore/infra error — the
 * route must react to this by responding 409 and skipping every
 * notification/audit side effect, never by retrying or falling back to
 * memory storage the way a genuine Firestore failure does.
 */
export class ShipmentRevisionConflictError extends Error {
  readonly code = "SHIPMENT_VERSION_CONFLICT";
  readonly currentRevision: number;
  readonly currentShipment: unknown;

  constructor(currentRevision: number, currentShipment: unknown) {
    super("This shipment was updated by someone else. Please reload the latest version before saving again.");
    this.name = "ShipmentRevisionConflictError";
    this.currentRevision = currentRevision;
    this.currentShipment = currentShipment;
  }
}

/**
 * Synchronous, dependency-injected equivalent of the Firestore transaction
 * (server.ts's applyShipmentRevisionedUpdate) for the in-memory fallback store
 * used in local development. Takes the live `shipments` array reference (the
 * caller's memory store, mutated in place) rather than reaching for any
 * global state itself, so this is fully unit-testable without booting the
 * server. The read of the current shipment and the write of the updated one
 * happen in the same synchronous call with no `await` in between — same
 * reasoning as InMemorySequenceCounter.next() (shipmentNumbering.ts): Node's
 * single-threaded event loop cannot interleave a second, concurrent call's
 * read/write into the middle of this one.
 */
export function applyRevisionedShipmentUpdateMemory<T extends { id: string; revision?: number }>(
  shipments: T[],
  shipmentId: string,
  expectedRevision: number,
  buildUpdated: (current: T, nextRevision: number) => T
): T {
  const idx = shipments.findIndex((s) => s.id === shipmentId);
  if (idx === -1) {
    throw new Error("Shipment not found");
  }
  const current = shipments[idx];
  const { ok, currentRevision, nextRevision } = checkShipmentRevision(current.revision, expectedRevision);
  if (!ok) {
    throw new ShipmentRevisionConflictError(currentRevision, current);
  }
  const updated = buildUpdated(current, nextRevision);
  shipments[idx] = updated;
  return updated;
}

/**
 * PR #111 review (Blocker 2): every route that mutates an existing shipment
 * document — not just the human edit form PUT /api/shipments/:id above —
 * must bump revision, or an admin's edit form opened before that mutation
 * would still save successfully afterward without ever detecting the
 * change (checkShipmentRevision only rejects a MISMATCHED revision; a
 * writer that never advances it can't produce a mismatch).
 *
 * This is the narrow-writer counterpart to applyRevisionedShipmentUpdateMemory
 * for callers that are NOT a human edit form holding a specific revision it
 * read — status updates, document/chat/share appends and toggles, and
 * similar single-field/append-only server-owned mutations. There is no
 * expectedRevision to check (the caller never had one to submit — a driver
 * status update, a chat attachment, a public share-link subscribe), so this
 * always applies `mutate` and unconditionally advances the revision by
 * exactly 1. Any admin edit form opened beforehand will still 409 on its
 * next save, exactly as if another admin had edited the shipment directly.
 * Same synchronous, no-`await`-between-read-and-write atomicity guarantee
 * as applyRevisionedShipmentUpdateMemory.
 */
export function applyNarrowShipmentUpdateMemory<T extends { id: string; revision?: number }>(
  shipments: T[],
  shipmentId: string,
  mutate: (current: T) => T
): T {
  const idx = shipments.findIndex((s) => s.id === shipmentId);
  if (idx === -1) {
    throw new Error("Shipment not found");
  }
  const current = shipments[idx];
  const nextRevision = resolveStoredRevision(current.revision) + 1;
  const mutated = mutate(current);
  const updated = { ...mutated, revision: nextRevision };
  shipments[idx] = updated;
  return updated;
}
