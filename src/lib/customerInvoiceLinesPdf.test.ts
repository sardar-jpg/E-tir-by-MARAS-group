import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInvoicePdfModel } from "./accountingPdfModel";
import type { CustomerInvoice } from "../types";

/**
 * Line-based customer-invoice PDF: renders the service lines + totals and NEVER
 * leaks vendor cost, internal cost base, markup, gross profit, or internal
 * notes. Plus server-side wiring assertions (buildInvoiceFromBody recomputes
 * totals server-authoritatively) and audit action registration.
 */
const lineInvoice = (over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id: "i1", invoiceNumber: "MAR-2026-1002", shipmentId: "s1", shipmentNumber: "MAR-2026-1002",
  clientId: "c1", companyName: "Uruk Industrial Spares Group", currency: "USD", pricingMode: "manual",
  costBasis: 3000, // INTERNAL — must never appear on the PDF
  grossProfit: 1300, // INTERNAL — must never appear on the PDF
  internalNotes: "vendor TransLog paid 2000 — internal only",
  sellingAmount: 4300, grandTotal: 4300, subtotal: 4300,
  invoiceDate: "2026-06-03", dueDate: "2026-06-18", paymentTerms: "15 days",
  customerNotes: "Thank you for your business.",
  status: "issued", createdAt: "t", issuedAt: "2026-06-03",
  invoiceLines: [
    { id: "l1", serviceType: "Sea Freight", description: "Guangzhou → Umm Qasr", quantity: 1, unit: "Shipment", unitPrice: 2500, amount: 2500 },
    { id: "l2", serviceType: "Land Freight", description: "Umm Qasr → Erbil", quantity: 1, unit: "Trip", unitPrice: 900, amount: 900 },
    { id: "l3", serviceType: "Customs Clearance", description: "Customs clearance service", quantity: 1, unit: "Service", unitPrice: 450, amount: 450 },
    { id: "l4", serviceType: "Documentation Fee", description: "Shipping documentation", quantity: 1, unit: "Service", unitPrice: 100, amount: 100 },
    { id: "l5", serviceType: "Port Handling", description: "Port handling charges", quantity: 1, unit: "Service", unitPrice: 350, amount: 350 },
  ],
  ...over,
});

describe("line-based invoice PDF model", () => {
  it("renders one row per service line with unit price + amount columns", () => {
    const m = buildInvoicePdfModel({ invoice: lineInvoice(), company: null, bank: null, language: "en", nowIso: "t" });
    expect(m.rows!).toHaveLength(5);
    const cols = m.columns!.map((c) => c.key);
    expect(cols).toContain("service");
    expect(cols).toContain("unitPrice");
    expect(m.rows![0].service).toBe("Sea Freight");
    expect(m.rows![0].unitPrice).toContain("2,500");
  });
  it("shows a Grand Total equal to the invoice grand total", () => {
    const m = buildInvoicePdfModel({ invoice: lineInvoice(), company: null, bank: null, language: "en", nowIso: "t" });
    const grand = m.totals!.find((t) => /Grand Total/i.test(t.label));
    expect(grand).toBeTruthy();
    expect(grand!.value).toContain("4,300");
  });
  it("NEVER contains internal cost, gross profit, markup, or internal notes", () => {
    const m = buildInvoicePdfModel({ invoice: lineInvoice(), company: null, bank: null, language: "en", nowIso: "t" });
    const json = JSON.stringify(m);
    expect(json).not.toContain("3000");       // costBasis
    expect(json).not.toContain("1300");       // grossProfit
    expect(json).not.toContain("TransLog");   // vendor name (internalNotes)
    expect(json).not.toContain("internal only");
    expect(json.toLowerCase()).not.toContain("markup");
    expect(json.toLowerCase()).not.toContain("profit");
  });
  it("shows the customer notes, not internal notes", () => {
    const m = buildInvoicePdfModel({ invoice: lineInvoice(), company: null, bank: null, language: "en", nowIso: "t" });
    expect(m.notes).toBe("Thank you for your business.");
  });
});

describe("legacy invoice PDF (no lines) still renders a single selling-total row", () => {
  it("keeps one row + a single total when invoiceLines is absent", () => {
    const legacy = lineInvoice({ invoiceLines: undefined, subtotal: undefined, grandTotal: undefined, description: "Freight services", sellingAmount: 4000 });
    const m = buildInvoicePdfModel({ invoice: legacy, company: null, bank: null, language: "en", nowIso: "t" });
    expect(m.rows!).toHaveLength(1);
    expect(m.totals!).toHaveLength(1);
    expect(m.totals![0].value).toContain("4,000");
  });
});

describe("server wiring — line-based invoice is server-authoritative", () => {
  const server = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf8");
  it("buildInvoiceFromBody recomputes lines + totals server-side (browser values ignored)", () => {
    expect(server).toContain("sanitizeInvoiceLines(body.invoiceLines)");
    expect(server).toContain("computeInvoiceTotals(linesResult.lines");
    // The customer total is the server-computed grand total (drives the ledger).
    expect(server).toContain("sellingAmount: totals.grandTotal");
    expect(server).toContain("grandTotal: totals.grandTotal");
  });
  it("requires a price-difference reason when the total differs from the agreed price", () => {
    expect(server).toContain("price_difference_reason_required");
    expect(server).toContain("agreedPriceDifference");
  });
  it("audits the draft + the price difference", () => {
    expect(server).toContain("AUDIT_ACTIONS.invoiceDraftCreated");
    expect(server).toContain("AUDIT_ACTIONS.invoicePriceDifferenceRecorded");
  });
});
