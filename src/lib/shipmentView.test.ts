import { describe, it, expect } from "vitest";
import { buildShipmentViewForRole } from "./shipmentView";
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
    documents: [
      { id: "doc-cmr", name: "CMR.pdf", url: "https://storage.example/cmr", category: "cmr", uploadedBy: "Admin", uploadedAt: "2026-01-01T00:00:00.000Z", isSharedExternally: false },
      { id: "doc-invoice", name: "Invoice.pdf", url: "https://storage.example/invoice", category: "invoice", uploadedBy: "Admin", uploadedAt: "2026-01-01T00:00:00.000Z", isSharedExternally: false },
      { id: "doc-invoice-approved", name: "Invoice-approved.pdf", url: "https://storage.example/invoice2", category: "invoice", uploadedBy: "Admin", uploadedAt: "2026-01-01T00:00:00.000Z", isSharedExternally: true },
      { id: "doc-other", name: "Misc.pdf", url: "https://storage.example/other", category: "other", uploadedBy: "Admin", uploadedAt: "2026-01-01T00:00:00.000Z", isSharedExternally: false },
      { id: "doc-photo", name: "loading.jpg", url: "https://storage.example/photo", category: "photo", uploadedBy: "Admin", uploadedAt: "2026-01-01T00:00:00.000Z", isSharedExternally: false },
    ],
    timeline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    isLinkShared: false,
    shareToken: "tok_abc123",
    shareIncludeDocuments: true,
    shareIncludePhotos: true,
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
    additionalDrivers: [
      { driverId: "driver-2", driverName: "Baran Demir", truckNumber: "06 XYZ 456", agreedAmount: 1500 },
      { driverId: "driver-3", driverName: "Cemal Kaya", truckNumber: "16 QRS 789", agreedAmount: 1800 },
    ],
    ...overrides,
  };
}

describe("buildShipmentViewForRole", () => {
  it("returns the shipment unchanged for admin", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "admin", id: "admin" });
    expect(view).toBe(shipment);
    expect(view.agreedAmount).toBe(3200);
    expect(view.internalNotes).toBe("Expedite customs at Ibrahim Khalil.");
    expect(view.additionalDrivers?.[0].agreedAmount).toBe(1500);
    expect(view.companyName).toBe("Acme Trading");
    expect(view.customerEmails).toEqual(["ops@acmetrading.example"]);
    expect(view.customerNotificationHistory).toHaveLength(1);
  });

  it("strips agreedAmount, internalNotes, and every additionalDrivers agreedAmount for a client", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "client", id: "client-1" });

    expect(view.agreedAmount).toBeUndefined();
    expect("agreedAmount" in view).toBe(false);
    expect(view.internalNotes).toBeUndefined();
    expect("internalNotes" in view).toBe(false);
    expect(view.additionalDrivers?.every((ad) => !("agreedAmount" in ad))).toBe(true);

    // Normal fields the client dashboard needs still come through.
    expect(view.shipmentNumber).toBe("MAR-2026-1001");
    expect(view.status).toBe("In Transit");

    // A client sees its own identity/contact data unchanged.
    expect(view.companyName).toBe("Acme Trading");
    expect(view.customerEmails).toEqual(["ops@acmetrading.example"]);
    expect(view.customerNotificationHistory).toHaveLength(1);
    expect(view.loadingContactNumber).toBe("+964 750 000 0000");
    expect(view.deliveryContactNumber).toBe("+90 555 000 0000");
  });

  it("keeps the top-level agreedAmount for the assigned primary driver, but hides other drivers' amounts", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "driver", id: "driver-1" });

    expect(view.agreedAmount).toBe(3200);
    expect(view.internalNotes).toBeUndefined();
    expect(view.additionalDrivers?.find((ad) => ad.driverId === "driver-2")?.agreedAmount).toBeUndefined();
    expect(view.additionalDrivers?.find((ad) => ad.driverId === "driver-3")?.agreedAmount).toBeUndefined();

    // Driver App must never receive customer/client identity or contact info.
    expect(view.companyName).toBeUndefined();
    expect("companyName" in view).toBe(false);
    expect(view.customerEmails).toBeUndefined();
    expect("customerEmails" in view).toBe(false);
    expect(view.customerNotificationHistory).toBeUndefined();
    expect("customerNotificationHistory" in view).toBe(false);
    expect("loadingContactNumber" in view).toBe(false);
    expect("deliveryContactNumber" in view).toBe(false);
  });

  it("hides the top-level agreedAmount from a co-driver, but keeps their own additionalDrivers amount", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "driver", id: "driver-2" });

    expect(view.agreedAmount).toBeUndefined();
    expect(view.additionalDrivers?.find((ad) => ad.driverId === "driver-2")?.agreedAmount).toBe(1500);
    expect(view.additionalDrivers?.find((ad) => ad.driverId === "driver-3")?.agreedAmount).toBeUndefined();

    expect("companyName" in view).toBe(false);
    expect("customerEmails" in view).toBe(false);
    expect("customerNotificationHistory" in view).toBe(false);
    expect("loadingContactNumber" in view).toBe(false);
    expect("deliveryContactNumber" in view).toBe(false);
  });

  it("hides every agreedAmount from a driver with no relationship to the shipment", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "driver", id: "driver-unrelated" });

    expect(view.agreedAmount).toBeUndefined();
    expect(view.additionalDrivers?.every((ad) => !("agreedAmount" in ad))).toBe(true);

    expect("companyName" in view).toBe(false);
    expect("customerEmails" in view).toBe(false);
    expect("customerNotificationHistory" in view).toBe(false);
    expect("loadingContactNumber" in view).toBe(false);
    expect("deliveryContactNumber" in view).toBe(false);
  });

  it("passes through shipments with no additionalDrivers array untouched", () => {
    const shipment = makeShipment({ additionalDrivers: undefined });
    const view = buildShipmentViewForRole(shipment, { role: "client", id: "client-1" });

    expect(view.additionalDrivers).toBeUndefined();
    expect(view.agreedAmount).toBeUndefined();
  });

  it("keeps every document, including unapproved invoice/other ones, for admin", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "admin", id: "admin" });

    expect(view.documents.map((d) => d.id).sort()).toEqual(
      ["doc-cmr", "doc-invoice", "doc-invoice-approved", "doc-other", "doc-photo"].sort()
    );
  });

  it("only gives a driver operational documents — never invoice, other, or photo", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "driver", id: "driver-1" });

    expect(view.documents.map((d) => d.id)).toEqual(["doc-cmr"]);
  });

  it("hides unapproved invoice/other documents from a client, keeps them once approved", () => {
    const shipment = makeShipment();
    const view = buildShipmentViewForRole(shipment, { role: "client", id: "client-1" });

    const ids = view.documents.map((d) => d.id).sort();
    expect(ids).toEqual(["doc-cmr", "doc-invoice-approved", "doc-photo"].sort());
    expect(ids).not.toContain("doc-invoice");
    expect(ids).not.toContain("doc-other");
  });
});
