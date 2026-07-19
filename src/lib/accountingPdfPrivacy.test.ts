import { describe, it, expect } from "vitest";
import { renderAccountingPdf } from "./accountingPdfRender";
import { buildInvoicePdfModel, buildReceiptPdfModel, buildStatementPdfModel } from "./accountingPdfModel";
import { buildCustomerAccountStatement } from "./customerAccountStatement";
import type { CustomerInvoice, PaymentReceipt, CustomerPayment, CompanyProfile } from "../types";

// Distinctive markers that MUST NOT leak into any customer-facing document.
const COST_MARKER = "7654321"; // costBasis
const PROFIT_MARKER = "9876543"; // grossProfit
const INTERNAL_NOTE = "INTERNALCOSTMEMO_DO_NOT_SHOW";
const VENDOR_MARKER = "SECRETVENDORNAME";

const company: CompanyProfile = { companyName: "MARAS Group", footerText: "Thank you" };

// An invoice carrying PRIVATE internal cost/profit/notes alongside the
// customer-facing selling amount.
const invoice: CustomerInvoice = {
  id: "i1", invoiceNumber: "MAR-2026-2001", shipmentId: "s1", shipmentNumber: "MAR-2026-2001",
  clientId: "c1", companyName: "Acme Importers", currency: "USD", pricingMode: "manual",
  costBasis: Number(COST_MARKER), grossProfit: Number(PROFIT_MARKER), internalNotes: INTERNAL_NOTE,
  manualAmount: 1500, sellingAmount: 1500, description: "Freight Istanbul → Baghdad",
  notes: "Payment due in 30 days", status: "issued", createdAt: "t", issuedAt: "2026-07-01T00:00:00Z",
};

// The rendered PDF (English, Latin font) embeds text as literal content-stream
// strings, so a plain latin1 scan reliably proves absence of a leaked token.
const bytesInclude = (buf: Buffer, needle: string) => buf.toString("latin1").includes(needle);

describe("customer-facing PDFs never leak internal cost / profit / vendor / notes", () => {
  it("invoice PDF excludes costBasis, grossProfit, and internal notes", async () => {
    const model = buildInvoicePdfModel({ invoice, company, bank: null, language: "en", nowIso: "t" });
    // The built model itself must not carry the internal fields.
    const modelJson = JSON.stringify(model);
    expect(modelJson).not.toContain(COST_MARKER);
    expect(modelJson).not.toContain(PROFIT_MARKER);
    expect(modelJson).not.toContain(INTERNAL_NOTE);
    // And the rendered bytes must not either.
    const buf = await renderAccountingPdf(model);
    expect(bytesInclude(buf, COST_MARKER)).toBe(false);
    expect(bytesInclude(buf, PROFIT_MARKER)).toBe(false);
    expect(bytesInclude(buf, INTERNAL_NOTE)).toBe(false);
    // Sanity: the customer-facing selling amount IS present.
    expect(bytesInclude(buf, "1,500.00")).toBe(true);
  });

  it("receipt PDF carries no internal cost/profit (payments hold none)", async () => {
    const receipt: PaymentReceipt = {
      id: "r1", receiptNumber: "RCPT-0001", paymentId: "p1", clientId: "c1", companyName: "Acme Importers",
      amount: 500, currency: "USD", paymentDate: "2026-07-05", paymentMethod: "wire",
      allocations: [{ invoiceId: "i1", invoiceNumber: "MAR-2026-2001", amount: 500 }],
      status: "issued", issuedBy: "u", issuedAt: "t",
    };
    const buf = await renderAccountingPdf(buildReceiptPdfModel({ receipt, company, language: "en", nowIso: "t" }));
    expect(bytesInclude(buf, COST_MARKER)).toBe(false);
    expect(bytesInclude(buf, PROFIT_MARKER)).toBe(false);
    expect(bytesInclude(buf, VENDOR_MARKER)).toBe(false);
  });

  it("customer account statement PDF excludes internal cost/profit", async () => {
    const payments: CustomerPayment[] = [{
      id: "p1", clientId: "c1", companyName: "Acme Importers", amount: 500, currency: "USD",
      paymentDate: "2026-07-05", paymentMethod: "wire", allocations: [{ invoiceId: "i1", invoiceNumber: "MAR-2026-2001", amount: 500 }],
      status: "active", createdBy: "u", createdAt: "2026-07-05T00:00:00Z",
    }];
    const statement = buildCustomerAccountStatement({ companyName: "Acme Importers", currency: "USD", invoices: [invoice], payments, from: "2026-07-01", to: "2026-07-31" });
    const buf = await renderAccountingPdf(buildStatementPdfModel({ statement, company, language: "en", nowIso: "t" }));
    expect(bytesInclude(buf, COST_MARKER)).toBe(false);
    expect(bytesInclude(buf, PROFIT_MARKER)).toBe(false);
    expect(bytesInclude(buf, INTERNAL_NOTE)).toBe(false);
  });
});
