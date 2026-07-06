/**
 * shipmentView.ts
 *
 * Standalone, testable role-based redaction of the Shipment record,
 * extracted from server.ts so it can be unit tested without booting the
 * full Express server (which requires live Firebase credentials) — same
 * rationale as auth.ts.
 *
 * agreedAmount (and per-driver additionalDrivers[].agreedAmount) is the
 * price privately agreed between Admin and a specific driver. It must
 * never reach Client/Customer views, and a driver must never see another
 * driver's agreed amount. internalNotes is Admin-only for the same reason.
 * Admins always see the unredacted record.
 */
import type { Shipment } from "../types";

export type ShipmentAccessSession = {
  role: "admin" | "driver" | "client";
  id: string;
};

export type ShipmentView = Omit<Shipment, "agreedAmount" | "internalNotes"> & {
  agreedAmount?: number;
  internalNotes?: string;
};

export function buildShipmentViewForRole(
  shipment: Shipment,
  session: ShipmentAccessSession
): ShipmentView {
  if (session.role === "admin") {
    return shipment;
  }

  // Neither drivers nor clients get internalNotes (Admin-only) or the raw
  // top-level agreedAmount — a driver only earns it back below if they are
  // this shipment's assigned primary driver.
  const { agreedAmount: _agreedAmount, internalNotes: _internalNotes, additionalDrivers, ...rest } = shipment;

  const redactedAdditionalDrivers = additionalDrivers?.map((ad) => {
    if (session.role === "driver" && ad.driverId === session.id) {
      return ad;
    }
    const { agreedAmount: _adAmount, ...adWithoutAmount } = ad;
    return adWithoutAmount;
  });

  const isOwnPrimaryShipment = session.role === "driver" && shipment.assignedDriverId === session.id;

  return {
    ...rest,
    ...(isOwnPrimaryShipment ? { agreedAmount: shipment.agreedAmount } : {}),
    ...(additionalDrivers ? { additionalDrivers: redactedAdditionalDrivers } : {}),
  };
}
