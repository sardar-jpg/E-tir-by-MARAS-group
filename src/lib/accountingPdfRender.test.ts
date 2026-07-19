import { describe, it, expect } from "vitest";
import { renderAccountingPdf } from "./accountingPdfRender";
import { buildInvoicePdfModel, buildVoucherPdfModel } from "./accountingPdfModel";
import type { CustomerInvoice, VendorPaymentTransaction, CompanyProfile } from "../types";

const company: CompanyProfile = { companyName: "MARAS Group", address: "Erbil", email: "a@b.co", footerText: "Thanks" };
const invoice: CustomerInvoice = {
  id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "Acme",
  currency: "USD", pricingMode: "manual", costBasis: 0, sellingAmount: 1500, description: "Freight", status: "issued", createdAt: "t", issuedAt: "t",
};
const voucher: VendorPaymentTransaction = {
  id: "vp1", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", costStatementId: "s1", costItemId: "ci1",
  vendorName: "Carrier", amount: 4000, currency: "USD", paymentDate: "2026-07-03", paymentMethod: "wire", createdBy: "u", createdAt: "t", status: "active",
};

const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";

describe("accounting PDF renderer produces real PDF bytes", () => {
  it("renders a customer invoice (LTR)", async () => {
    const buf = await renderAccountingPdf(buildInvoicePdfModel({ invoice, company, bank: null, language: "en", nowIso: "t" }));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(800);
  });
  it("renders an RTL (Arabic) document without throwing", async () => {
    const buf = await renderAccountingPdf(buildInvoicePdfModel({ invoice, company, bank: null, language: "ar", nowIso: "t" }));
    expect(isPdf(buf)).toBe(true);
  });
  it("renders an internal vendor voucher", async () => {
    const buf = await renderAccountingPdf(buildVoucherPdfModel({ payment: voucher, company, language: "en", nowIso: "t", remainingPayable: 6000 }));
    expect(isPdf(buf)).toBe(true);
  });
});
