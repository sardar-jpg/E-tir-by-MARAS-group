import { describe, it, expect } from "vitest";
import { resolveExportItems, resolveExportNotes, type IssuedInvoiceForExport } from "./costStatementExportView";
import type { CostStatement, Shipment } from "../types";

// Accounting Phase 1: customer-facing export figures come from the ISSUED
// customer invoice, never the driver's agreedAmount. A shipment's agreedAmount
// (3200 in these fixtures) must never appear as a customer amount.
const issued = (total: number, currency: IssuedInvoiceForExport["currency"] = "USD"): IssuedInvoiceForExport => ({ total, currency });

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
    const items = resolveExportItems("invoice", makeStatement(), makeShipment(), undefined, issued(5000));
    expect(items.some((i) => i.supplierName === "Zagros Carriers" || i.supplierName === "Border Customs Agency")).toBe(false);
    expect(items.every((i) => i.internalNotes === undefined)).toBe(true);
    expect(items.reduce((sum, i) => sum + i.totalAmount, 0)).toBe(5000);
  });

  it("never includes a real vendor/supplier name or internalNotes for 'client_statement' mode", () => {
    const items = resolveExportItems("client_statement", makeStatement(), makeShipment(), undefined, issued(5000));
    expect(items.some((i) => i.supplierName === "Zagros Carriers" || i.supplierName === "Border Customs Agency")).toBe(false);
    expect(items.every((i) => i.internalNotes === undefined)).toBe(true);
  });

  it("uses the ISSUED INVOICE total (in the invoice currency), never agreedAmount or internal totalCost", () => {
    const statement = makeStatement({ totalCost: 999999 });
    const shipment = makeShipment({ agreedAmount: 3200 });
    const invoiceItems = resolveExportItems("invoice", statement, shipment, undefined, issued(5000, "EUR"));
    expect(invoiceItems.reduce((sum, i) => sum + i.totalAmount, 0)).toBe(5000); // NOT 3200 agreed, NOT 999999 cost
    expect(invoiceItems.every((i) => i.currency === "EUR")).toBe(true);
  });

  it("shows a 'No Issued Customer Invoice' notice (no money) when no invoice is issued", () => {
    for (const mode of ["invoice", "client_statement"] as const) {
      const items = resolveExportItems(mode, makeStatement(), makeShipment(), undefined, null);
      expect(items).toHaveLength(1);
      expect(items[0].description).toContain("No Issued Customer Invoice");
      expect(items[0].totalAmount).toBe(0);
      // agreedAmount (3200) must NOT leak in as a customer figure.
      expect(items.some((i) => i.totalAmount === 3200)).toBe(false);
    }
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

// ═══ Accounting Phase B — customer-money separation on exports ═══
import { resolveExportHeaderStatus } from "./costStatementExportView";

describe("Accounting Phase B/1 — client statement money source", () => {
  it("the customer statement's 'Payment Received' comes from customerReceivedAmount, NEVER from the expense paidAmount", () => {
    // MARAS paid vendors 4,900 but the customer has paid NOTHING → no
    // payment line may appear on the customer statement.
    const paidVendorsOnly = makeStatement({ paidAmount: 4900, customerReceivedAmount: 0 });
    const items = resolveExportItems("client_statement", paidVendorsOnly, makeShipment(), undefined, issued(5000));
    expect(items.some((i) => i.costType === "Payment Received")).toBe(false);
    // A real customer receipt DOES appear, at its own amount.
    const received = makeStatement({ paidAmount: 0, customerReceivedAmount: 1500 });
    const pay = resolveExportItems("client_statement", received, makeShipment(), undefined, issued(5000)).find((i) => i.costType === "Payment Received");
    expect(pay?.totalAmount).toBe(-1500);
  });

  it("mode-aware header status: expense status only on 'statement'; CUSTOMER status (from the ISSUED invoice) on invoice/client; none on vendor docs", () => {
    // Vendors fully paid (expense status "Paid"), customer paid nothing.
    const stmt = makeStatement({ paymentStatus: "Paid", paidAmount: 999, customerReceivedAmount: 0 });
    const inv = issued(5000);
    expect(resolveExportHeaderStatus("statement", stmt, inv)).toEqual({ kind: "expense", value: "Paid" });
    // An invoice must NOT read "Paid" because MARAS paid a supplier.
    expect(resolveExportHeaderStatus("invoice", stmt, inv)).toEqual({ kind: "customer", value: "Unpaid" });
    expect(resolveExportHeaderStatus("client_statement", stmt, inv)).toEqual({ kind: "customer", value: "Unpaid" });
    expect(resolveExportHeaderStatus("vendor_statement", stmt, inv)).toBeNull();
  });

  it("no issued invoice → no customer status (agreedAmount can never fabricate one)", () => {
    const stmt = makeStatement({ customerReceivedAmount: 0 });
    expect(resolveExportHeaderStatus("invoice", stmt, null)).toBeNull();
    expect(resolveExportHeaderStatus("client_statement", stmt, null)).toBeNull();
  });

  it("customer status is relative to the ISSUED invoice total, not agreedAmount (overpayment → Credit)", () => {
    // agreedAmount is 3200; the issued invoice is 5000. A 5,500 receipt is a
    // Credit against the 5000 INVOICE (against 3200 agreed it would also be a
    // credit, but the amount that matters is the invoice's).
    const credit = makeStatement({ customerReceivedAmount: 5500 });
    expect(resolveExportHeaderStatus("invoice", credit, issued(5000))).toEqual({ kind: "customer", value: "Credit" });
    // Exactly the invoice total → Paid (would be "Credit" if it read 3200 agreed).
    const paid = makeStatement({ customerReceivedAmount: 5000 });
    expect(resolveExportHeaderStatus("invoice", paid, issued(5000))).toEqual({ kind: "customer", value: "Paid" });
  });
});
