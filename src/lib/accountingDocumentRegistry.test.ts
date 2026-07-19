import { describe, it, expect } from "vitest";
import {
  ACCOUNTING_DOCUMENTS, ACCOUNTING_DOCUMENT_TYPES, getAccountingDocument,
  isCustomerFacingDocument, isSupportedDocumentLanguage,
} from "./accountingDocumentRegistry";

describe("accounting document registry — five canonical types", () => {
  it("defines exactly the five document types", () => {
    expect([...ACCOUNTING_DOCUMENT_TYPES]).toEqual([
      "customer_invoice", "payment_receipt", "customer_statement", "vendor_payment_voucher", "cost_statement",
    ]);
  });

  it("classifies customer-facing vs internal correctly", () => {
    expect(isCustomerFacingDocument("customer_invoice")).toBe(true);
    expect(isCustomerFacingDocument("payment_receipt")).toBe(true);
    expect(isCustomerFacingDocument("customer_statement")).toBe(true);
    // Internal-only documents.
    expect(isCustomerFacingDocument("vendor_payment_voucher")).toBe(false);
    expect(isCustomerFacingDocument("cost_statement")).toBe(false);
  });

  it("each type carries a required permission, template key, and languages", () => {
    for (const t of ACCOUNTING_DOCUMENT_TYPES) {
      const def = getAccountingDocument(t);
      expect(def.requiredPermission).toBeTruthy();
      expect(def.templateKey).toBeTruthy();
      expect([...def.supportedLanguages].sort()).toEqual(["ar", "en", "tr"]);
    }
  });

  it("maps each type to the enforced permission key", () => {
    expect(ACCOUNTING_DOCUMENTS.customer_invoice.requiredPermission).toBe("invoices.print");
    expect(ACCOUNTING_DOCUMENTS.payment_receipt.requiredPermission).toBe("receipts.print");
    expect(ACCOUNTING_DOCUMENTS.customer_statement.requiredPermission).toBe("customerStatements.export");
    expect(ACCOUNTING_DOCUMENTS.vendor_payment_voucher.requiredPermission).toBe("vendorPayments.printVoucher");
    expect(ACCOUNTING_DOCUMENTS.cost_statement.requiredPermission).toBe("costStatements.print");
  });

  it("customer-facing docs privacy-list the internal fields that must never appear", () => {
    const priv = ACCOUNTING_DOCUMENTS.customer_invoice.privateFields;
    for (const f of ["costBasis", "costBaseAmount", "markupValue", "markupAmount", "grossProfit", "internalNotes"]) {
      expect(priv).toContain(f);
    }
  });

  it("supported-language guard", () => {
    expect(isSupportedDocumentLanguage("customer_invoice", "ar")).toBe(true);
    expect(isSupportedDocumentLanguage("customer_invoice", "fr")).toBe(false);
  });

  it("filenames are deterministic and path-safe", () => {
    expect(ACCOUNTING_DOCUMENTS.customer_invoice.buildFileName("MAR-2026-1001")).toBe("Invoice_MAR-2026-1001.pdf");
    expect(ACCOUNTING_DOCUMENTS.customer_statement.buildFileName("Acme/../x", "ar")).toBe("Statement_Acme-..-x_ar.pdf");
    expect(ACCOUNTING_DOCUMENTS.customer_invoice.buildFileName("a/b\\c")).not.toContain("/");
  });
});
