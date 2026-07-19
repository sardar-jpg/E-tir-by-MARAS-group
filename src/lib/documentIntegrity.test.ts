import { describe, it, expect } from "vitest";
import { buildInvoicePdfModel } from "./accountingPdfModel";
import type { BankAccount, CompanyProfile, CustomerInvoice } from "../types";
import { buildBankAccountSnapshot } from "./bankSnapshot";

/**
 * Increment 6 §17 — an ISSUED document renders from the immutable snapshots
 * captured at issue time. Later edits to the master company profile, logo,
 * bank, or customer must NEVER change it. The renderer reads the invoice's own
 * companySnapshot + bankAccountSnapshot, never live master data.
 */
const issuedCompanySnapshot: CompanyProfile = {
  companyName: "MARAS Group (as issued)", email: "issued@maras.iq", logoUrl: "data:image/png;base64,ORIGINALLOGO",
  footerText: "Issued footer", version: 3,
};
const bankMaster: BankAccount = {
  id: "b1", bankName: "Bank As Issued", accountHolderName: "MARAS", accountNumber: "ISSUED-111",
  swift: "ISSUEDXX", currency: "USD", active: true, isDefaultForCurrency: true, createdAt: "t",
};
const invoice: CustomerInvoice = {
  id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001",
  clientId: "c1", companyName: "Acme (as issued)", currency: "USD", pricingMode: "manual",
  costBasis: 500, manualAmount: 1000, sellingAmount: 1000, status: "issued", createdAt: "t", issuedAt: "t2",
  companySnapshot: issuedCompanySnapshot, companyProfileVersion: 3,
  bankAccountSnapshot: buildBankAccountSnapshot(bankMaster),
};

describe("issued document integrity (§17)", () => {
  it("company profile edits do not alter an issued invoice (test 37)", () => {
    const editedLiveCompany: CompanyProfile = { companyName: "MARAS RENAMED", email: "new@maras.iq", logoUrl: "data:image/png;base64,NEWLOGO", version: 9 };
    const model = buildInvoicePdfModel({ invoice, company: editedLiveCompany, bank: null, language: "en", nowIso: "t" });
    expect(model.company.name).toBe("MARAS Group (as issued)");
    expect(model.company.logoUrl).toContain("ORIGINALLOGO"); // logo edit ignored (test 39)
    expect(model.footerText).toBe("Issued footer");
  });

  it("logo edit on the master does not change the issued document (test 39)", () => {
    const model = buildInvoicePdfModel({ invoice, company: { companyName: "x", logoUrl: "data:image/png;base64,NEWLOGO" }, bank: null, language: "en", nowIso: "t" });
    expect(model.company.logoUrl).toContain("ORIGINALLOGO");
    expect(model.company.logoUrl).not.toContain("NEWLOGO");
  });

  it("bank master edits do not change the issued invoice (test 12/38)", () => {
    const editedBank: BankAccount = { ...bankMaster, accountNumber: "CHANGED-999", bankName: "Renamed", active: false };
    const model = buildInvoicePdfModel({ invoice, company: null, bank: editedBank, language: "en", nowIso: "t" });
    expect(model.bank?.accountNumber).toBe("ISSUED-111");
    expect(model.bank?.bankName).toBe("Bank As Issued");
  });

  it("customer master rename does not change the issued document (test 38)", () => {
    // The document carries the customer name as captured on the invoice, not a
    // live customer lookup — renaming the master client never rewrites it.
    const model = buildInvoicePdfModel({ invoice, company: null, bank: null, language: "en", nowIso: "t" });
    expect(model.parties.find((p) => p.value === "Acme (as issued)")).toBeTruthy();
  });

  it("without any snapshot a DRAFT may preview live company/bank (only drafts)", () => {
    const draft: CustomerInvoice = { ...invoice, status: "draft", companySnapshot: undefined, bankAccountSnapshot: undefined };
    const liveCompany: CompanyProfile = { companyName: "Live Co", version: 5 };
    const model = buildInvoicePdfModel({ invoice: draft, company: liveCompany, bank: bankMaster, language: "en", nowIso: "t" });
    expect(model.company.name).toBe("Live Co");
    expect(model.bank?.accountNumber).toBe("ISSUED-111");
  });
});
