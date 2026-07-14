import { describe, it, expect } from "vitest";
import { buildSecureShareView, resolveUniqueShareTokenMatch } from "./publicShareView";
import type { Shipment } from "../types";

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-1",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Acme Trading",
    loadingCountry: "Iraq",
    loadingCity: "Erbil",
    loadingAddress: "Industrial Zone 1",
    loadingContactNumber: "+964 750 000 0000",
    deliveryCountry: "Turkey",
    deliveryCity: "Mersin",
    deliveryAddress: "Port Road 5",
    deliveryContactNumber: "+90 555 000 0000",
    cargoDescription: "Machinery parts",
    cargoWeight: 12000,
    truckNumber: "34 ABC 123",
    assignedDriverId: "driver-1",
    assignedDriverName: "Ahmed Yilmaz",
    agreedAmount: 3200,
    currency: "USD",
    internalNotes: "Expedite customs at Ibrahim Khalil.",
    status: "In Transit",
    documents: [],
    timeline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    isLinkShared: true,
    shareToken: "tok_abc123",
    shareIncludeDocuments: true,
    shareIncludePhotos: true,
    etd: "2026-01-03T00:00:00.000Z",
    eta: "2026-01-10T00:00:00.000Z",
    customerEmails: ["ops@acmetrading.example"],
    customerNotificationHistory: [
      {
        id: "notif-1",
        timestamp: "2026-01-02T00:00:00.000Z",
        type: "status_update",
        title: "Shipment in transit",
        message: "Your shipment is in transit.",
        email: "ops@acmetrading.example",
        channel: "email",
      },
    ],
    ...overrides,
  };
}

describe("buildSecureShareView", () => {
  it("never leaks internal-only or private contact fields", () => {
    const view = buildSecureShareView(makeShipment());

    expect("companyName" in view).toBe(false);
    expect("agreedAmount" in view).toBe(false);
    expect("currency" in view).toBe(false);
    expect("internalNotes" in view).toBe(false);
    expect("loadingContactNumber" in view).toBe(false);
    expect("deliveryContactNumber" in view).toBe(false);
  });

  it("BUG-21: drops shareToken/etd/eta and subscriber emails/history, which PublicTracking.tsx never reads", () => {
    const view = buildSecureShareView(makeShipment());

    expect("shareToken" in view).toBe(false);
    expect("etd" in view).toBe(false);
    expect("eta" in view).toBe(false);
    expect("customerEmails" in view).toBe(false);
    expect("customerNotificationHistory" in view).toBe(false);
  });

  it("keeps the fields PublicTracking.tsx actually renders", () => {
    const view = buildSecureShareView(makeShipment());

    expect(view.shipmentNumber).toBe("MAR-2026-1001");
    expect(view.status).toBe("In Transit");
    expect(view.loadingCity).toBe("Erbil");
    expect(view.deliveryCity).toBe("Mersin");
    expect(view.cargoDescription).toBe("Machinery parts");
    expect(view.cargoWeight).toBe(12000);
    expect(view.truckNumber).toBe("34 ABC 123");
    expect(view.assignedDriverName).toBe("Ahmed Yilmaz");
    expect(view.freightType).toBe("land");
  });

  it("keeps documents/photos as same-origin proxy paths, never a raw Storage URL", () => {
    const shipment = makeShipment({
      documents: [
        {
          id: "doc-1",
          name: "CMR.pdf",
          category: "cmr",
          url: "https://firebasestorage.googleapis.com/secret-token",
          uploadedBy: "admin-1",
          uploadedAt: "2026-01-01T00:00:00.000Z",
          isSharedExternally: true,
        },
        {
          id: "doc-2",
          name: "loading.jpg",
          category: "photo",
          url: "https://firebasestorage.googleapis.com/secret-token-2",
          uploadedBy: "admin-1",
          uploadedAt: "2026-01-01T00:00:00.000Z",
          isSharedExternally: true,
        },
      ],
    });

    const view = buildSecureShareView(shipment);

    expect(view.documents).toHaveLength(1);
    expect(view.documents[0].url).toBe("/api/share/tok_abc123/documents/doc-1");
    expect(view.photos).toHaveLength(1);
    expect(view.photos[0].url).toBe("/api/share/tok_abc123/documents/doc-2");
  });
});

describe("resolveUniqueShareTokenMatch — Phase 2A follow-up (blocking-issue fix, duplicate shareToken safety)", () => {
  it("returns null for zero matches — an unknown/malformed token", () => {
    expect(resolveUniqueShareTokenMatch([])).toBeNull();
  });

  it("returns the single match unchanged in the normal (non-duplicate) case", () => {
    const shipment = makeShipment({ id: "shipment-1" });
    expect(resolveUniqueShareTokenMatch([shipment])).toBe(shipment);
  });

  it("INVARIANT: resolves a duplicate-token match set deterministically by lowest document id, never an arbitrary/first-seen one", () => {
    const a = makeShipment({ id: "shipment-B" });
    const b = makeShipment({ id: "shipment-A" });
    const c = makeShipment({ id: "shipment-C" });
    // Order in the input array must not affect the result — a real
    // Firestore query's row order for a `.limit(n)` query with no
    // orderBy is undefined, so this must not depend on input order.
    expect(resolveUniqueShareTokenMatch([a, b, c])!.id).toBe("shipment-A");
    expect(resolveUniqueShareTokenMatch([c, a, b])!.id).toBe("shipment-A");
    expect(resolveUniqueShareTokenMatch([b, c, a])!.id).toBe("shipment-A");
  });

  it("INVARIANT: never returns a shipment NOT in the matches array — the wrong-shipment-exposure guard", () => {
    const matches = [makeShipment({ id: "shipment-X" }), makeShipment({ id: "shipment-Y" })];
    const resolved = resolveUniqueShareTokenMatch(matches);
    expect(matches.map((m) => m.id)).toContain(resolved!.id);
  });

  it("is idempotent — resolving the same duplicate set twice always returns the same shipment", () => {
    const matches = [makeShipment({ id: "shipment-2" }), makeShipment({ id: "shipment-1" })];
    const first = resolveUniqueShareTokenMatch(matches);
    const second = resolveUniqueShareTokenMatch(matches);
    expect(first!.id).toBe(second!.id);
  });
});
