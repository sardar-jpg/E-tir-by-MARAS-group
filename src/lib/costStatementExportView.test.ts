import { describe, it, expect } from "vitest";
import { resolveExportItems, resolveExportNotes } from "./costStatementExportView";
import type { CostStatement, Shipment } from "../types";

function makeStatement(overrides: Partial<CostStatement> = {}): CostStatement {
  return {
    shipmentId: "shipment-1",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Acme Trading",
    shipmentType: "land",
    date: "2026-01-01",
    currency: "USD",
    totalCost: 2000,
    paidAmount: 500,
    remainingBalance: 1500,
    paymentStatus: "Partial",
    notes: "Vendor invoice disputed, hold final payment until resolved.",
    items: [
      {
        id: "item-1",
        costType: "Trucking",
        description: "Border to Erbil leg",
        quantity: 1,
        unitPrice: 1200,
        totalAmount: 1200,
        currency: "USD",
        supplierName: "Zagros Carriers",
        internalNotes: "Negotiated 10% discount off list rate.",
      },
      {
        id: "item-2",
        costType: "Customs",
        description: "Ibrahim Khalil clearance",
        quantity: 1,
        unitPrice: 800,
        totalAmount: 800,
        currency: "USD",
        supplierName: "Border Customs Agency",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

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
    internalNotes: "",
    status: "In Transit",
    documents: [],
    timeline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    isLinkShared: false,
    shareToken: "tok_abc123",
    shareIncludeDocuments: true,
    shareIncludePhotos: true,
    freightType: "land",
    ...overrides,
  };
}

describe("resolveExportItems", () => {
  it("returns the real internal cost items for 'statement' mode", () => {
    const items = resolveExportItems("statement", makeStatement(), makeShipment());
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.supplierName === "Zagros Carriers")).toBe(true);
  });

  it("filters to only the selected vendor's real items for 'vendor_statement' mode", () => {
    const items = resolveExportItems("vendor_statement", makeStatement(), makeShipment(), "Zagros Carriers");
    expect(items).toHaveLength(1);
    expect(items[0].supplierName).toBe("Zagros Carriers");
  });

  it("never includes a real vendor/supplier name or internalNotes for 'invoice' mode", () => {
    const items = resolveExportItems("invoice", makeStatement(), makeShipment());
    expect(items.some((i) => i.supplierName === "Zagros Carriers" || i.supplierName === "Border Customs Agency")).toBe(false);
    expect(items.every((i) => i.internalNotes === undefined)).toBe(true);
    expect(items.reduce((sum, i) => sum + i.totalAmount, 0)).toBe(3200);
  });

  it("never includes a real vendor/supplier name or internalNotes for 'client_statement' mode", () => {
    const items = resolveExportItems("client_statement", makeStatement(), makeShipment());
    expect(items.some((i) => i.supplierName === "Zagros Carriers" || i.supplierName === "Border Customs Agency")).toBe(false);
    expect(items.every((i) => i.internalNotes === undefined)).toBe(true);
  });

  it("uses the shipment's agreedAmount, not the internal totalCost, for invoice/client_statement totals", () => {
    const statement = makeStatement({ totalCost: 999999 });
    const shipment = makeShipment({ agreedAmount: 3200 });
    const invoiceItems = resolveExportItems("invoice", statement, shipment);
    expect(invoiceItems.reduce((sum, i) => sum + i.totalAmount, 0)).toBe(3200);
  });
});

describe("resolveExportNotes", () => {
  it("returns internal notes only for 'statement' mode", () => {
    const notes = "Vendor invoice disputed, hold final payment until resolved.";
    expect(resolveExportNotes("statement", notes)).toBe(notes);
    expect(resolveExportNotes("invoice", notes)).toBe("");
    expect(resolveExportNotes("client_statement", notes)).toBe("");
    expect(resolveExportNotes("vendor_statement", notes)).toBe("");
  });
});
