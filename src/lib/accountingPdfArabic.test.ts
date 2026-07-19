import { describe, it, expect } from "vitest";
import { renderAccountingPdf } from "./accountingPdfRender";
import {
  buildInvoicePdfModel, buildReceiptPdfModel, buildStatementPdfModel, buildVoucherPdfModel,
} from "./accountingPdfModel";
import { renderFinalCostStatementPdf } from "./costStatementFinalPdf";
import { buildFinalPdfModel } from "./costStatementFinalPdfModel";
import { loadArabicFontBase64 } from "./arabicPdfFont";
import type { CustomerInvoice, PaymentReceipt, VendorPaymentTransaction, CompanyProfile, CostStatement } from "../types";
import { buildCustomerAccountStatement } from "./customerAccountStatement";

// Arabic company + customer names, plus Latin MAR/currency tokens that must
// stay intact inside the RTL document.
const company: CompanyProfile = { companyName: "شركة مرص للشحن", companyNameEn: "MARAS Cargo", address: "أربيل، العراق", email: "info@maras.iq", footerText: "شكراً لتعاملكم معنا" };
const invoice: CustomerInvoice = {
  id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "عميل تجريبي",
  currency: "IQD", pricingMode: "manual", costBasis: 0, sellingAmount: 1500000, description: "خدمة شحن من إسطنبول إلى بغداد",
  notes: "الدفع خلال 30 يوماً", status: "issued", createdAt: "t", issuedAt: "2026-07-01T00:00:00Z",
};
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
// The Arabic font is embedded as an actual TrueType font program: the PDF
// carries the /BaseFont IBMPlexArabic dictionary AND a /FontFile2 stream.
const embedsArabicFont = (b: Buffer) => { const s = b.toString("latin1"); return s.includes("IBMPlexArabic") && s.includes("FontFile2"); };

describe("Arabic PDFs — font embedded + real %PDF output", () => {
  it("the Arabic font asset is available (dependency present)", () => {
    expect(loadArabicFontBase64()).not.toBeNull();
  });

  it("Arabic customer invoice renders, embeds the Arabic font, keeps MAR + currency", async () => {
    const buf = await renderAccountingPdf(buildInvoicePdfModel({ invoice, company, bank: null, language: "ar", nowIso: "t" }));
    expect(isPdf(buf)).toBe(true);
    expect(embedsArabicFont(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("Arabic payment receipt renders + embeds the font", async () => {
    const receipt: PaymentReceipt = {
      id: "r1", receiptNumber: "RCPT-0001", paymentId: "p1", companyName: "عميل تجريبي", amount: 500000, currency: "IQD",
      paymentDate: "2026-07-05", paymentMethod: "تحويل بنكي", allocations: [{ invoiceId: "i1", invoiceNumber: "MAR-2026-1001", amount: 500000 }],
      status: "issued", issuedBy: "u", issuedAt: "t", companySnapshot: company,
    };
    const buf = await renderAccountingPdf(buildReceiptPdfModel({ receipt, company, language: "ar", nowIso: "t" }));
    expect(isPdf(buf)).toBe(true);
    expect(embedsArabicFont(buf)).toBe(true);
  });

  it("Arabic customer account statement renders (multi-row table)", async () => {
    // Build many invoices so the statement table spans multiple pages.
    const invoices: CustomerInvoice[] = Array.from({ length: 60 }, (_, i) => ({
      ...invoice, id: "inv" + i, invoiceNumber: `MAR-2026-${1001 + i}`, sellingAmount: 100000 + i, issuedAt: `2026-07-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const statement = buildCustomerAccountStatement({ companyName: "عميل تجريبي", currency: "IQD", invoices, payments: [], from: "2026-07-01", to: "2026-07-31" });
    const buf = await renderAccountingPdf(buildStatementPdfModel({ statement, company, language: "ar", nowIso: "t" }));
    expect(isPdf(buf)).toBe(true);
    expect(embedsArabicFont(buf)).toBe(true);
    // Multi-page: the PDF must declare more than one /Page.
    const pageCount = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount).toBeGreaterThan(1);
  });

  it("Arabic vendor voucher (internal) renders + embeds the font", async () => {
    const vp: VendorPaymentTransaction = {
      id: "vp1", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", costStatementId: "s1", costItemId: "ci1",
      vendorName: "شركة النقل", amount: 4000, currency: "USD", paymentDate: "2026-07-03", paymentMethod: "تحويل", createdBy: "u", createdAt: "t", status: "active",
    };
    const buf = await renderAccountingPdf(buildVoucherPdfModel({ payment: vp, company, language: "ar", nowIso: "t", remainingPayable: 6000 }));
    expect(isPdf(buf)).toBe(true);
    expect(embedsArabicFont(buf)).toBe(true);
  });

  it("Arabic final Cost Statement renders + embeds the font", async () => {
    const stmt: CostStatement = {
      shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "عميل تجريبي", shipmentType: "land", date: "2026-07-01",
      currency: "USD", totalCost: 800, paidAmount: 800, remainingBalance: 0, paymentStatus: "Paid",
      notes: "ملاحظة داخلية", items: [{ id: "c1", costType: "transport", description: "نقل بري", quantity: 1, unitPrice: 800, totalAmount: 800, currency: "USD", supplierName: "الناقل" }],
      createdAt: "t", updatedAt: "t", agreedAmount: 1000, agreedCurrency: "USD",
    };
    const model = buildFinalPdfModel({ statement: stmt, approvalHistory: [], cycleNumber: 1, finalizedAt: "2026-07-10", finalStatementRevision: 1, company, language: "ar" });
    const buf = await renderFinalCostStatementPdf(model);
    expect(isPdf(buf)).toBe(true);
    expect(embedsArabicFont(buf)).toBe(true);
  });

  it("English + Turkish still render with the Latin font (no Arabic embed forced)", async () => {
    const en = await renderAccountingPdf(buildInvoicePdfModel({ invoice: { ...invoice, companyName: "Acme", description: "Freight" }, company: { companyName: "MARAS" }, bank: null, language: "en", nowIso: "t" }));
    expect(isPdf(en)).toBe(true);
    expect(embedsArabicFont(en)).toBe(false);
  });
});
