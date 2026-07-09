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
 *
 * companyName/customerEmails/customerNotificationHistory identify the
 * client and must never reach the Driver App — drivers take job
 * instructions from Admin/MARAS Operations only, never the customer
 * directly. Clients get these back unchanged since it's their own data.
 *
 * loadingContactNumber/deliveryContactNumber are the customer's own
 * pickup/delivery contact phone (AdminPanel defaults them from the
 * client's profile phone) — same identity-leak risk as companyName, so a
 * driver never gets them either. A driver coordinates through
 * driver_admin chat, not by calling the customer directly. Clients keep
 * these unchanged (their own data), same as the other identity fields.
 *
 * Admins always see the unredacted record.
 *
 * feature/document-category-visibility-review: `documents` used to be
 * spread through unfiltered via `...rest` below — a driver or client got
 * every document on the shipment regardless of category, including
 * invoice/other entries that can carry accounting, cost, or internal
 * content (e.g. a customer's own invoice, or a client_admin chat
 * attachment auto-saved as a document — see shouldSaveChatFileAsShipmentDocument,
 * chatVisibility.ts). isDocumentVisibleToDriver/isDocumentVisibleToClient
 * (documentAccess.ts) now filter it per role, same as every other
 * role-sensitive field here.
 */
import type { Shipment } from "../types";
import { isDocumentVisibleToClient, isDocumentVisibleToDriver } from "./documentAccess";

export type ShipmentAccessSession = {
  role: "admin" | "driver" | "client";
  id: string;
};

export type ShipmentView = Omit<
  Shipment,
  | "agreedAmount"
  | "internalNotes"
  | "companyName"
  | "customerEmails"
  | "customerNotificationHistory"
  | "loadingContactNumber"
  | "deliveryContactNumber"
> & {
  agreedAmount?: number;
  internalNotes?: string;
  companyName?: string;
  customerEmails?: string[];
  customerNotificationHistory?: Shipment["customerNotificationHistory"];
  loadingContactNumber?: string;
  deliveryContactNumber?: string;
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
  // this shipment's assigned primary driver. companyName/customerEmails/
  // customerNotificationHistory/loadingContactNumber/deliveryContactNumber
  // are stripped here too, and only the client branch below earns them
  // back — a driver never does.
  const {
    agreedAmount: _agreedAmount,
    internalNotes: _internalNotes,
    companyName: _companyName,
    customerEmails: _customerEmails,
    customerNotificationHistory: _customerNotificationHistory,
    loadingContactNumber: _loadingContactNumber,
    deliveryContactNumber: _deliveryContactNumber,
    additionalDrivers,
    documents: _documents,
    ...rest
  } = shipment;

  const documentsForRole =
    session.role === "driver"
      ? shipment.documents.filter(isDocumentVisibleToDriver)
      : shipment.documents.filter(isDocumentVisibleToClient);

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
    documents: documentsForRole,
    ...(isOwnPrimaryShipment ? { agreedAmount: shipment.agreedAmount } : {}),
    ...(additionalDrivers ? { additionalDrivers: redactedAdditionalDrivers } : {}),
    ...(session.role === "client"
      ? {
          companyName: shipment.companyName,
          customerEmails: shipment.customerEmails,
          customerNotificationHistory: shipment.customerNotificationHistory,
          loadingContactNumber: shipment.loadingContactNumber,
          deliveryContactNumber: shipment.deliveryContactNumber,
        }
      : {}),
  };
}
