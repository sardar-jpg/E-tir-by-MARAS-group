/**
 * publicShareView.ts
 *
 * BUG-21: builds the anonymous, token-only payload returned by
 * GET /api/share/:token (and the subscribe endpoint that echoes the same
 * shape back). Extracted from server.ts, same rationale as shipmentView.ts,
 * so the shape of this public, unauthenticated response can be unit tested
 * directly.
 *
 * loadingContactNumber/deliveryContactNumber are private client/driver
 * phone numbers used internally by Admin (see AdminPanel.tsx) — they were
 * being copied into this public view without ever being read by
 * PublicTracking.tsx, so they're left out here rather than handed to
 * anyone with just a share link. shareToken/etd/eta were likewise copied
 * in but never read by PublicTracking.tsx (the token it needs comes from
 * the URL, not the response body), so they're dropped too.
 *
 * customerEmails/customerNotificationHistory (subscriber emails) were
 * never part of this view to begin with — PublicTracking.tsx's "Active
 * Verified Receivers" UI reads them but they've always been undefined,
 * so that UI never renders. They're deliberately kept out here rather
 * than added: this is an unauthenticated, token-only endpoint, and
 * subscriber email addresses are private client data that anyone holding
 * a share link should not be able to enumerate.
 *
 * Everything else mirrors what PublicTracking.tsx actually reads. See
 * documentAccess.ts for how documents/photos are filtered and given
 * same-origin proxy URLs instead of raw Firebase Storage links.
 */
import type { Shipment } from "../types";
import { isDocumentVisibleForShare, buildPublicShareDocumentPath } from "./documentAccess";

export type PublicShareView = ReturnType<typeof buildSecureShareView>;

export function buildSecureShareView(shipment: Shipment) {
  return {
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    loadingCountry: shipment.loadingCountry,
    loadingCity: shipment.loadingCity,
    loadingAddress: shipment.loadingAddress,
    deliveryCountry: shipment.deliveryCountry,
    deliveryCity: shipment.deliveryCity,
    deliveryAddress: shipment.deliveryAddress,
    cargoDescription: shipment.cargoDescription,
    cargoWeight: shipment.cargoWeight,
    truckNumber: shipment.truckNumber,
    timeline: shipment.timeline,
    updatedAt: shipment.updatedAt,
    assignedDriverName: shipment.assignedDriverName,

    // Sea & Air precise properties
    freightType: shipment.freightType || "land",
    shippingLine: shipment.shippingLine || "",
    vesselName: shipment.vesselName || "",
    containerNumber: shipment.containerNumber || "",
    bookingNumber: shipment.bookingNumber || "",
    billOfLadingNumber: shipment.billOfLadingNumber || "",
    portOfLoading: shipment.portOfLoading || "",
    portOfDischarge: shipment.portOfDischarge || "",
    finalDestination: shipment.finalDestination || "",
    numberOfContainers: shipment.numberOfContainers || 0,
    containerType: shipment.containerType || "",
    airline: shipment.airline || "",
    flightNumber: shipment.flightNumber || "",
    airWaybillNumber: shipment.airWaybillNumber || "",
    airportOfDeparture: shipment.airportOfDeparture || "",
    airportOfArrival: shipment.airportOfArrival || "",
    grossWeight: shipment.grossWeight || 0,
    chargeableWeight: shipment.chargeableWeight || 0,
    numberOfPackages: shipment.numberOfPackages || 0,

    // BUG-12: never hand the public share view a raw Firebase Storage
    // download URL — that URL's access token isn't revocable and would
    // keep working forever even after a document's isSharedExternally is
    // turned back off. Instead every document/photo gets a same-origin
    // proxy path (see /api/share/:token/documents/:docId in server.ts),
    // which re-checks isDocumentVisibleForShare on every single request.
    documents: shipment.shareIncludeDocuments
      ? shipment.documents
          .filter((d) => isDocumentVisibleForShare(d, shipment) && d.category !== "photo")
          .map((d) => ({ ...d, url: buildPublicShareDocumentPath(shipment.shareToken, d.id) }))
      : [],
    photos: shipment.shareIncludePhotos
      ? shipment.documents
          .filter((d) => isDocumentVisibleForShare(d, shipment) && d.category === "photo")
          .map((d) => ({ ...d, url: buildPublicShareDocumentPath(shipment.shareToken, d.id) }))
      : [],
  };
}
