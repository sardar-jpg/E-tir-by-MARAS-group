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
import { stripPassword } from "./sanitize";

export type SanitizedDriver = Omit<Driver, "password">;

export function sanitizeDriver(driver: Driver): SanitizedDriver {
  return stripPassword(driver);
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
