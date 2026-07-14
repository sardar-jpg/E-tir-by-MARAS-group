/**
 * driverVisibility.ts
 *
 * BUG-05: GET /api/drivers returned every driver's phone/email/live GPS to
 * any logged-in client or driver — it only stripped `password` and handed
 * back the full fleet roster regardless of who asked. This scopes that
 * response to what the caller actually needs:
 *   - super/operation admin: the full roster (still minus password) —
 *     needed for dispatch/assignment.
 *   - accounts admin: nothing — see BUG-08, the UI never shows them a
 *     Drivers tab, and the server shouldn't hand it over just because the
 *     route was called directly.
 *   - driver: only their own record, plus any co-drivers on shipments
 *     they're actually assigned to — never another driver's contact info
 *     or GPS otherwise.
 *   - client: no phone/email/GPS at all, just enough to identify the
 *     driver(s) handling their own shipment(s).
 *
 * Extracted as a pure function (same rationale as shipmentView.ts /
 * chatVisibility.ts) so it's unit testable without booting the server.
 */
import type { Driver, Shipment } from "../types";
import { stripPassword, stripFirebaseUid } from "./sanitize";
import type { PageFilter } from "./pagination";

export type SanitizedDriver = Omit<Driver, "password" | "firebaseUid">;

/**
 * The one place every user-facing Driver response should go through —
 * strips both the password hash and the internal, cryptographically-
 * verified firebaseUid (review follow-up to fix/apple-driver-account-deletion:
 * previously only password was stripped here, so GET /api/drivers leaked
 * every driver's Firebase Auth uid to the full admin roster and to any
 * co-driver on a shared shipment).
 */
export function sanitizeDriver(driver: Driver): SanitizedDriver {
  return stripFirebaseUid(stripPassword(driver));
}

/** Minimal, non-sensitive fields safe to show a client — no phone/email/GPS. */
export type ClientSafeDriver = {
  id: string;
  name: string;
  truckNumber: string;
  truckType?: string;
  avatarUrl?: string;
};

export function toClientSafeDriver(driver: Driver): ClientSafeDriver {
  return {
    id: driver.id,
    name: driver.name,
    truckNumber: driver.truckNumber,
    truckType: driver.truckType,
    avatarUrl: driver.avatarUrl,
  };
}

/** Shared English label for a shipment's freight mode, used across the driver cards, detail panel, and shipment list. */
export const FREIGHT_TYPE_LABELS: Record<"land" | "sea" | "air", string> = {
  land: "Land Freight",
  sea: "Sea Freight",
  air: "Air Freight",
};

/**
 * A driver's own agreed amount for a shipment — null if this driver has
 * none recorded (never falls back to another driver's amount or a fake
 * 0). Shared by the driver shipment list, active-job card, and shipment
 * detail panel so all three agree on when "Not available" is shown
 * instead of a stale/wrong figure.
 */
export function resolveDriverAgreedAmount(
  shipment: Pick<Shipment, "assignedDriverId" | "agreedAmount" | "additionalDrivers">,
  driverId: string
): number | null {
  if (shipment.assignedDriverId === driverId) {
    return shipment.agreedAmount !== undefined ? shipment.agreedAmount : null;
  }
  const ad = shipment.additionalDrivers?.find((d) => d.driverId === driverId);
  return ad && ad.agreedAmount !== undefined ? ad.agreedAmount : null;
}

/**
 * A driver's own truck for a shipment — null if not recorded. The
 * shipment-level `truckNumber` belongs to the primary assigned driver, so
 * a co-driver must see their own `additionalDrivers[].truckNumber` entry
 * instead, never someone else's plate.
 */
export function resolveDriverTruckNumber(
  shipment: Pick<Shipment, "assignedDriverId" | "truckNumber" | "additionalDrivers">,
  driverId: string
): string | null {
  if (shipment.assignedDriverId === driverId) {
    return shipment.truckNumber || null;
  }
  const ad = shipment.additionalDrivers?.find((d) => d.driverId === driverId);
  return ad?.truckNumber || null;
}

type ShipmentAssignment = Pick<Shipment, "assignedDriverId" | "additionalDrivers">;

function assignedDriverIds(shipments: ShipmentAssignment[]): Set<string> {
  const ids = new Set<string>();
  for (const s of shipments) {
    if (s.assignedDriverId) ids.add(s.assignedDriverId);
    s.additionalDrivers?.forEach((ad) => ids.add(ad.driverId));
  }
  return ids;
}

export type DriverListSession = {
  role: "admin" | "driver" | "client";
  id: string;
  adminType?: string;
};

/**
 * `relevantShipments` must already be scoped to what this session is
 * allowed to see — every shipment the driver is assigned to (primary or
 * co-driver), or only the client's own company's shipments. This function
 * does not re-derive shipment ownership itself, it only turns "shipments I
 * can see" into "drivers I'm allowed to know about."
 */
export function scopeDriverListForSession(
  allDrivers: Driver[],
  session: DriverListSession,
  relevantShipments: ShipmentAssignment[]
): Array<SanitizedDriver | ClientSafeDriver> {
  if (session.role === "admin") {
    if (session.adminType === "accounts") return [];
    return allDrivers.map(sanitizeDriver);
  }

  if (session.role === "driver") {
    const ids = assignedDriverIds(relevantShipments);
    ids.add(session.id);
    return allDrivers.filter((d) => ids.has(d.id)).map(sanitizeDriver);
  }

  // client
  const ids = assignedDriverIds(relevantShipments);
  return allDrivers.filter((d) => ids.has(d.id)).map(toClientSafeDriver);
}

/**
 * Phase 4 follow-up (Firestore scalability audit, PR #99 review).
 *
 * Derives Shipment.additionalDriverIds — a flat, deduplicated array of
 * just the driver ids from additionalDrivers — from the request payload
 * server.ts writes on every shipment create/update. additionalDrivers
 * (the full `{driverId, driverName, truckNumber, agreedAmount}` records)
 * remains the single source of truth; this is purely a query-optimized
 * denormalization so "is this driver an additional driver on this
 * shipment" can be a Firestore `array-contains` query (used by GET
 * /api/notifications' ownership lookup) instead of loading every
 * shipment to check in Node — `array-contains` needs a flat array of
 * primitives, not an array of objects, since it matches on exact element
 * value, not "an object in this array has field X".
 *
 * Migration note (documented, not silently hidden): a shipment written
 * before this field existed has no additionalDriverIds at all, so it
 * won't match an `array-contains` query for a driver who is ONLY listed
 * as one of its additional drivers (not the primary assignedDriverId,
 * which was always a plain queryable field and has no such gap). Two
 * ways this heals:
 *  1. Automatically, the next time that shipment is created/updated
 *     through the normal write path (this function runs again).
 *  2. `scripts/backfill-additional-driver-ids.ts` — a one-time,
 *     explicitly-run backfill for shipments that are never otherwise
 *     updated. Not run automatically by this codebase or by any CI job;
 *     an operator runs it manually against production when ready.
 */
export function deriveAdditionalDriverIds(
  additionalDrivers: Array<{ driverId?: string }> | undefined
): string[] {
  const ids = new Set<string>();
  for (const ad of additionalDrivers || []) {
    if (ad && typeof ad.driverId === "string" && ad.driverId.length > 0) {
      ids.add(ad.driverId);
    }
  }
  return Array.from(ids);
}

/**
 * Phase 4 follow-up (Firestore scalability audit, PR #99 review).
 *
 * The query-level replacement for GET /api/notifications' old
 * "read every shipment, keep the ones where assignedDriverId matches or
 * additionalDrivers contains me" Node-side filter. Two independent scopes
 * (assignedDriverId is a plain, always-populated field with no legacy
 * gap; additionalDriverIds is the derived array above — see its own
 * legacy-record note) — server.ts runs one query per scope and unions the
 * matched shipment ids, the same OR-via-independent-queries pattern
 * buildDriverClientNotificationQueryScopes already uses.
 */
export function buildDriverOwnedShipmentQueryScopes(driverId: string): PageFilter[] {
  return [
    { field: "assignedDriverId", op: "==", value: driverId },
    { field: "additionalDriverIds", op: "array-contains", value: driverId },
  ];
}
