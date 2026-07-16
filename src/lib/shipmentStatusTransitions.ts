import type { ShipmentStatus } from "../types";

/**
 * shipmentStatusTransitions.ts
 *
 * PR #111 review (third correction): PUT /api/shipments/:id/status accepted
 * any string as the new status with no ordering check at all — a driver or
 * admin request could move a shipment backward, resubmit its current
 * status, or skip required stages, and an open status-update form has no
 * server-side signal telling it those options were never valid to submit.
 *
 * This is the single source of truth for "what status may a shipment move
 * to next," used by both the server (authoritative enforcement) and the
 * UI (so the status control only ever offers the one legal next status).
 * Kept as pure functions with no I/O — same rationale as
 * shipmentRevision.ts/shipmentNumbering.ts — so the ordering rules are
 * unit-testable without booting a server, and reusable unchanged from
 * React components.
 *
 * The three sequences below are not invented here — they're the exact
 * per-freight-type status lists already used throughout this codebase
 * (AdminPanel.tsx's status filter chips, the Manual Status Milestone
 * dropdown, and the shipment-edit "Status Override" dropdown all repeat
 * this same ordering; POST /api/shipments already seeds new sea/air
 * shipments at "Booking Confirmed" — see server.ts). This module only
 * centralizes them and adds the forward-only ordering rule none of those
 * call sites enforced before.
 *
 * "Completed" is Sea/Air's own terminal status, not "Closed" — Sea/Air
 * shipments never have a "Closed" status at all (see the ShipmentStatus
 * union, src/types.ts). The existing status-label translations already
 * treat the two as the same real-world event: 'Closed' is labeled
 * "Shipment Closed & Invoiced" and 'Completed' is labeled "Completed &
 * Closed" (server.ts's labelMap). getClosingStatusForFreightMode below
 * is the single place that Land-vs-Sea/Air distinction is resolved, so
 * every "is this shipment closed" check (status-transition terminal rule,
 * chat lock, close-authorization gate) stays consistent automatically.
 */

export type FreightMode = "land" | "sea" | "air";

/**
 * Sea/Air shipments are always initialized at "Booking Confirmed" and
 * always admin-driven (see server.ts POST /api/shipments and AdminPanel's
 * Manual Status Milestone panel comment: "Air and Maritime cargos do not
 * utilize driver apps"). A shipment with no freightType at all is a
 * pre-existing Land shipment (freightType was added after Land-only
 * shipments already existed) — same default already used elsewhere in
 * this codebase (e.g. server.ts's initialStatus computation).
 */
export function resolveFreightMode(freightType: string | null | undefined): FreightMode {
  if (freightType === "sea") return "sea";
  if (freightType === "air") return "air";
  return "land";
}

export const LAND_STATUS_SEQUENCE: ShipmentStatus[] = [
  "New",
  "Assigned",
  "Accepted",
  "Loading",
  "Loaded",
  "In Transit",
  "Border Crossing",
  "Customs Clearance",
  "Arrived",
  "Delivered",
  "Closed",
];

export const SEA_STATUS_SEQUENCE: ShipmentStatus[] = [
  "Booking Confirmed",
  "Container Released",
  "Loaded on Vessel",
  "Vessel Departed",
  "In Transit",
  "Arrived at Port",
  "Customs Clearance",
  "Released",
  "Out for Delivery",
  "Delivered",
  "Completed",
];

export const AIR_STATUS_SEQUENCE: ShipmentStatus[] = [
  "Booking Confirmed",
  "Cargo Received",
  "Security Check Completed",
  "Departed Airport",
  "In Transit",
  "Arrived Airport",
  "Customs Clearance",
  "Released",
  "Out for Delivery",
  "Delivered",
  "Completed",
];

const SEQUENCE_BY_FREIGHT_MODE: Record<FreightMode, ShipmentStatus[]> = {
  land: LAND_STATUS_SEQUENCE,
  sea: SEA_STATUS_SEQUENCE,
  air: AIR_STATUS_SEQUENCE,
};

/** The full set of every status known to any freight mode's sequence — used to tell "unknown status" apart from "valid status, wrong freight workflow." */
const ALL_KNOWN_STATUSES = new Set<string>([
  ...LAND_STATUS_SEQUENCE,
  ...SEA_STATUS_SEQUENCE,
  ...AIR_STATUS_SEQUENCE,
]);

export function getStatusSequenceForFreightMode(mode: FreightMode): ShipmentStatus[] {
  return SEQUENCE_BY_FREIGHT_MODE[mode];
}

/**
 * Land's terminal status is "Closed"; Sea and Air have no "Closed" status
 * at all (see the sequences above) — their terminal status is "Completed".
 * The single place every closing-related rule (transition-sequence
 * terminal check, close-authorization gate, chat read-only lock) resolves
 * "what does 'closed' mean for this shipment" from, so all three stay
 * consistent by construction.
 */
export function getClosingStatusForFreightMode(mode: FreightMode): ShipmentStatus {
  return mode === "land" ? "Closed" : "Completed";
}

/**
 * Whether `status` is this shipment's freight-mode-appropriate closing
 * status ("Closed" for Land, "Completed" for Sea/Air). Used by the chat
 * read-only lock and by the close-transition authorization gate — kept as
 * its own named predicate (rather than inlining the comparison at each
 * call site) so every caller stays correct if the closing-status mapping
 * above ever changes.
 */
export function isShipmentClosed(status: string, freightType?: string | null): boolean {
  return status === getClosingStatusForFreightMode(resolveFreightMode(freightType));
}

/**
 * The only status (or statuses) a shipment currently at `currentStatus`
 * may legally move to next, for its freight mode. Always at most one
 * element: "only the immediately following valid status may be selected."
 * Empty when `currentStatus` is already the freight mode's terminal status
 * (Closed/Completed — no further status exists), or when `currentStatus`
 * itself isn't part of this freight mode's sequence at all (a data
 * inconsistency — e.g. a Sea shipment somehow stamped with a Land-only
 * status — treated conservatively as "no legal next status" rather than
 * guessing).
 */
export function getAllowedNextShipmentStatuses(
  currentStatus: ShipmentStatus,
  freightType?: string | null
): ShipmentStatus[] {
  const sequence = getStatusSequenceForFreightMode(resolveFreightMode(freightType));
  const currentIndex = sequence.indexOf(currentStatus);
  if (currentIndex === -1 || currentIndex === sequence.length - 1) {
    return [];
  }
  return [sequence[currentIndex + 1]];
}

export type ShipmentStatusTransitionRejectionReason =
  | "unknown-status"
  | "wrong-freight-workflow"
  | "same-status"
  | "backward"
  | "skipped-stage";

export interface ShipmentStatusTransitionResult {
  ok: boolean;
  /** The only legal next status/es from currentStatus — always present, even on rejection, so the caller can tell the user what IS allowed. */
  allowedNextStatuses: ShipmentStatus[];
  /** Present only when ok is false. */
  reason?: ShipmentStatusTransitionRejectionReason;
}

/**
 * The authoritative decision behind every rule this module exists for:
 * "shipment statuses must move forward in the approved sequence only."
 * Rejects, with a specific machine-readable reason:
 *  - unknown-status: requestedStatus isn't any freight mode's status at all
 *  - wrong-freight-workflow: a real status, but not part of THIS shipment's
 *    freight-mode sequence (e.g. a Sea status requested for a Land shipment)
 *  - same-status: resubmitting the current status
 *  - backward: an earlier status in the same sequence
 *  - skipped-stage: a later status than the immediately-next one
 * Never mutates anything itself — server.ts/UI callers use the result to
 * decide whether to apply a change or reject it.
 */
export function validateShipmentStatusTransition(
  currentStatus: ShipmentStatus,
  requestedStatus: string,
  freightType?: string | null
): ShipmentStatusTransitionResult {
  const allowedNextStatuses = getAllowedNextShipmentStatuses(currentStatus, freightType);

  if (!ALL_KNOWN_STATUSES.has(requestedStatus)) {
    return { ok: false, allowedNextStatuses, reason: "unknown-status" };
  }

  const sequence = getStatusSequenceForFreightMode(resolveFreightMode(freightType));
  const requestedIndex = sequence.indexOf(requestedStatus as ShipmentStatus);
  if (requestedIndex === -1) {
    return { ok: false, allowedNextStatuses, reason: "wrong-freight-workflow" };
  }

  const currentIndex = sequence.indexOf(currentStatus);
  if (currentIndex === -1) {
    // currentStatus isn't part of this freight mode's sequence at all — a
    // pre-existing data inconsistency, not something to guess a decision
    // for. allowedNextStatuses is already [] from the call above.
    return { ok: false, allowedNextStatuses: [], reason: "wrong-freight-workflow" };
  }

  if (requestedIndex === currentIndex) {
    return { ok: false, allowedNextStatuses, reason: "same-status" };
  }
  if (requestedIndex < currentIndex) {
    return { ok: false, allowedNextStatuses, reason: "backward" };
  }
  if (requestedIndex > currentIndex + 1) {
    return { ok: false, allowedNextStatuses, reason: "skipped-stage" };
  }

  return { ok: true, allowedNextStatuses };
}

/**
 * Thrown by server.ts's status-update transaction callback when
 * validateShipmentStatusTransition rejects the requested change (and the
 * request isn't the one documented exception — see
 * isDriverAssignmentRejection below). Carries everything the route's 409
 * response needs. A distinct type from any Firestore/infra error, exactly
 * like ShipmentRevisionConflictError (shipmentRevision.ts) — the route
 * must react to this by responding with the structured rejection and
 * skipping every notification/audit side effect, never by retrying or
 * falling back to memory storage the way a genuine Firestore failure does.
 */
export class ShipmentStatusTransitionError extends Error {
  readonly code = "INVALID_SHIPMENT_STATUS_TRANSITION";
  readonly currentStatus: ShipmentStatus;
  readonly requestedStatus: string;
  readonly allowedNextStatuses: ShipmentStatus[];
  readonly reason: ShipmentStatusTransitionRejectionReason;

  constructor(
    currentStatus: ShipmentStatus,
    requestedStatus: string,
    allowedNextStatuses: ShipmentStatus[],
    reason: ShipmentStatusTransitionRejectionReason
  ) {
    super(
      allowedNextStatuses.length > 0
        ? `This shipment cannot move to "${requestedStatus}" right now. The next valid status is "${allowedNextStatuses[0]}".`
        : `This shipment cannot move to "${requestedStatus}" right now. It has no further status in its workflow.`
    );
    this.name = "ShipmentStatusTransitionError";
    this.currentStatus = currentStatus;
    this.requestedStatus = requestedStatus;
    this.allowedNextStatuses = allowedNextStatuses;
    this.reason = reason;
  }
}

/**
 * The next status a non-admin session (driver) may still submit through
 * the normal status-update control, or null when there is none — either
 * because the shipment is already at its freight mode's terminal status,
 * or because the only remaining step is the closing transition itself
 * (Closed/Completed), which is reserved for authorized MARAS staff (see
 * the close-authorization gate in server.ts's status route). Used by
 * DriverApplication.tsx to decide when to show its "job locked" state
 * instead of the status-update form.
 *
 * This is distinct from getAllowedNextShipmentStatuses: at "Arrived" (Land),
 * the next status is "Delivered" — not a closing transition — so a driver
 * can still submit it here even though "Arrived" itself might otherwise
 * look like a finished/terminal-ish status. Only once a shipment reaches
 * "Delivered" (whose only next status IS the closing one) does this
 * return null for a driver.
 */
export function getDriverSubmittableNextStatus(
  currentStatus: ShipmentStatus,
  freightType?: string | null
): ShipmentStatus | null {
  const [next] = getAllowedNextShipmentStatuses(currentStatus, freightType);
  if (!next || isShipmentClosed(next, freightType)) {
    return null;
  }
  return next;
}

/**
 * Pre-existing, deliberate exception to "forward-only": a driver declining
 * an assignment resets the shipment from "Assigned" back to "New" so
 * dispatch can hand it to someone else (DriverApplication.tsx's
 * handleRejectAssignment, PUT /api/shipments/:id/status with
 * status: "New"). This is an assignment-correction action, not a step in
 * normal forward status progression — kept as its own narrowly-scoped,
 * named check (rather than folding it into
 * validateShipmentStatusTransition's general rule) so it stays visibly
 * separate and can never accidentally widen into a general "move
 * backward" allowance. Land-only by construction: "Assigned" doesn't
 * exist in the Sea/Air sequences at all.
 */
export function isDriverAssignmentRejection(currentStatus: ShipmentStatus, requestedStatus: string): boolean {
  return currentStatus === "Assigned" && requestedStatus === "New";
}
