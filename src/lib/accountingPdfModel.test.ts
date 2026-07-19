import { describe, it, expect } from "vitest";
import { buildInvoicePdfModel, buildReceiptPdfModel, buildStatementPdfModel, buildVoucherPdfModel } from "./accountingPdfModel";
import type { CustomerInvoice, PaymentReceipt, VendorPaymentTransaction, CompanyProfile } from "../types";
import { buildCustomerAccountStatement } from "./customerAccountStatement";

const company: CompanyProfile = { companyName: "MARAS Group", email: "info@maras.iq", footerText: "Thank you", version: 2 };
const invoice: CustomerInvoice = {
  id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "Acme",
  currency: "USD", pricingMode: "cost_plus", costBasis: 800, costBaseAmount: 800, markupType: "percentage", markupValue: 25, markupAmount: 200, sellingAmount: 1000, grossProfit: 200,
  description: "Freight", notes: "Pay in 30 days", internalNotes: "margin 20%", status: "issued", createdAt: "t", issuedAt: "2026-07-01T00:00:00Z",
};

describe("invoice PDF model (customer-facing) hides internal cost/profit", () => {
  it("carries selling total + branding but NO cost/profit/internal notes", () => {
    const m = buildInvoicePdfModel({ invoice, company, bank: null, language: "en", nowIso: "2026-07-19T00:00:00Z" });
    const json = JSON.stringify(m);
    expect(m.docType).toBe("invoice");
    expect(m.totals![0].value).toContain("1,000.00");
    expect(m.badge!.kind).toBe("issued");
    expect(json).not.toContain("margin 20%"); // internalNotes
    expect(json).not.toContain("800"); // costBasis
    expect(json).not.toContain("grossProfit");
    expect(m.company.name).toBe("MARAS Group");
    expect(m.footerText).toBe("Thank you");
  });
  it("draft invoice gets a draft badge (preview separate from issued)", () => {
    const m = buildInvoicePdfModel({ invoice: { ...invoice, status: "draft" }, company, bank: null, language: "en", nowIso: "t" });
    expect(m.badge!.kind).toBe("draft");
  });
  it("Arabic sets RTL direction", () => {
    expect(buildInvoicePdfModel({ invoice, company, bank: null, language: "ar", nowIso: "t" }).direction).toBe("rtl");
    expect(buildInvoicePdfModel({ invoice, company, bank: null, language: "en", nowIso: "t" }).direction).toBe("ltr");
  });
});

describe("receipt PDF model", () => {
  const receipt: PaymentReceipt = {
    id: "r1", receiptNumber: "RCPT-0001", paymentId: "p1", companyName: "Acme", amount: 1000, currency: "USD",
    paymentDate: "2026-07-05", paymentMethod: "wire", reference: "TX1",
    allocations: [{ invoiceId: "i1", invoiceNumber: "MAR-2026-1001", amount: 1000 }], status: "issued", issuedBy: "u", issuedAt: "t",
  };
  it("lists covered invoices + amount; void badge when voided", () => {
    const m = buildReceiptPdfModel({ receipt, company, language: "en", nowIso: "t", advanceCredit: 250 });
    expect(m.rows![0].inv).toBe("MAR-2026-1001");
    expect(m.totals!.some((t) => t.value.includes("1,000.00"))).toBe(true);
    expect(m.totals!.some((t) => t.value.includes("250.00"))).toBe(true); // advance credit
    const voided = buildReceiptPdfModel({ receipt: { ...receipt, status: "void", voidReason: "err" }, company, language: "en", nowIso: "t" });
    expect(voided.badge!.kind).toBe("void");
  });
});

describe("statement PDF model", () => {
  it("renders opening + rows + closing", () => {
    const statement = buildCustomerAccountStatement({
      companyName: "Acme", currency: "USD",
      invoices: [invoice], payments: [], from: "2026-07-01", to: "2026-07-31",
    });
    const m = buildStatementPdfModel({ statement, company, language: "en", nowIso: "2026-07-19T00:00:00Z" });
    expect(m.docType).toBe("statement");
    expect(m.rows!.some((r) => r.ref === "MAR-2026-1001")).toBe(true);
    expect(m.totals![0].value).toContain("1,000.00"); // closing
  });
});

describe("vendor voucher PDF model (internal)", () => {
  const vp: VendorPaymentTransaction = {
    id: "vp1", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", costStatementId: "s1", costItemId: "ci1",
    vendorName: "Carrier Co", amount: 4000, currency: "USD", paymentDate: "2026-07-03", paymentMethod: "wire",
    createdBy: "u", createdAt: "t", status: "active",
  };
  it("is marked internal and shows remaining payable", () => {
    const m = buildVoucherPdfModel({ payment: vp, company, language: "en", nowIso: "t", remainingPayable: 6000, costItemDescription: "Truck" });
    expect(m.docType).toBe("voucher");
    expect(m.internalNotice).toBeTruthy();
    expect(m.meta.some((r) => r.value.includes("6,000.00"))).toBe(true);
    expect(m.flags.showBank).toBe(false);
  });
});
