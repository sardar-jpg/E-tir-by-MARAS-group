/**
 * accountingDocumentRegistry.ts — one typed registry for the five canonical
 * accounting document types (Increment 6, section 2). It is the single source
 * of truth for each document's required permission, customer-facing vs internal
 * classification, supported languages, filename format, and privacy rules. The
 * PDF routes resolve everything through here so classification/permission can
 * never drift between documents. No clock, db, or session.
 */
import type { Language } from "../types";

export type AccountingDocumentType =
  | "customer_invoice"
  | "payment_receipt"
  | "customer_statement"
  | "vendor_payment_voucher"
  | "cost_statement";

export const ACCOUNTING_DOCUMENT_TYPES: readonly AccountingDocumentType[] = [
  "customer_invoice", "payment_receipt", "customer_statement", "vendor_payment_voucher", "cost_statement",
];

export type DocumentClassification = "customer_facing" | "internal";

export interface AccountingDocumentDefinition {
  type: AccountingDocumentType;
  /** The granular permission a logged-in employee needs to render/print it. */
  requiredPermission: string;
  classification: DocumentClassification;
  supportedLanguages: readonly Language[];
  /** Template config key used for template resolution. */
  templateKey: "invoice" | "receipt" | "statement" | "voucher" | "cost_statement";
  /** Private fields that must NEVER appear in this document's rendered output. */
  privateFields: readonly string[];
  buildFileName: (ref: string, language?: Language) => string;
}

const SUPPORTED_LANGS: readonly Language[] = ["en", "ar", "tr"];

/** Fields that must never reach a customer-facing document. */
const CUSTOMER_PRIVATE = [
  "costBasis", "costBaseAmount", "markupValue", "markupAmount", "grossProfit",
  "internalNotes", "vendorCost", "approvalComments", "ledgerId",
] as const;

const safe = (s: string) => String(s).replace(/[^A-Za-z0-9._-]/g, "-");

export const ACCOUNTING_DOCUMENTS: Record<AccountingDocumentType, AccountingDocumentDefinition> = {
  customer_invoice: {
    type: "customer_invoice", requiredPermission: "invoices.print", classification: "customer_facing",
    supportedLanguages: SUPPORTED_LANGS, templateKey: "invoice", privateFields: CUSTOMER_PRIVATE,
    buildFileName: (ref) => `Invoice_${safe(ref)}.pdf`,
  },
  payment_receipt: {
    type: "payment_receipt", requiredPermission: "receipts.print", classification: "customer_facing",
    supportedLanguages: SUPPORTED_LANGS, templateKey: "receipt", privateFields: ["ledgerId", "internalNotes"],
    buildFileName: (ref) => `Receipt_${safe(ref)}.pdf`,
  },
  customer_statement: {
    type: "customer_statement", requiredPermission: "customerStatements.export", classification: "customer_facing",
    supportedLanguages: SUPPORTED_LANGS, templateKey: "statement", privateFields: ["ledgerId", "internalNotes"],
    buildFileName: (ref, lang) => `Statement_${safe(ref)}${lang ? "_" + lang : ""}.pdf`,
  },
  vendor_payment_voucher: {
    type: "vendor_payment_voucher", requiredPermission: "vendorPayments.printVoucher", classification: "internal",
    supportedLanguages: SUPPORTED_LANGS, templateKey: "voucher", privateFields: [],
    buildFileName: (ref) => `Voucher_${safe(ref)}.pdf`,
  },
  cost_statement: {
    type: "cost_statement", requiredPermission: "costStatements.print", classification: "internal",
    supportedLanguages: SUPPORTED_LANGS, templateKey: "cost_statement", privateFields: [],
    buildFileName: (ref) => `CostStatement_${safe(ref)}.pdf`,
  },
};

export function getAccountingDocument(type: AccountingDocumentType): AccountingDocumentDefinition {
  return ACCOUNTING_DOCUMENTS[type];
}

export function isCustomerFacingDocument(type: AccountingDocumentType): boolean {
  return ACCOUNTING_DOCUMENTS[type].classification === "customer_facing";
}

export function isSupportedDocumentLanguage(type: AccountingDocumentType, lang: string): boolean {
  return (ACCOUNTING_DOCUMENTS[type].supportedLanguages as readonly string[]).includes(lang);
}
