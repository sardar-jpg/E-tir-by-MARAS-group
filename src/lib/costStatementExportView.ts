/**
 * costStatementExportView.ts
 *
 * PR #45: AdminPanel's cost-statement export modal has an on-screen preview
 * that already redacts per statementPreviewMode — 'invoice' and
 * 'client_statement' (customer-facing) show only a synthetic freight-charge
 * line, never the raw internal cost items or accounting notes. But the PDF
 * (handleDownloadPDF, jsPDF) and CSV (handleExportCSV) exports built from
 * the same data ignored that redaction and always dumped every internal
 * CostItem — vendor/supplier name, unit price, internalNotes — plus the
 * statement-level internal notes, regardless of mode. An admin picking
 * "invoice" or "client statement" mode to send something to a customer
 * would get MARAS's vendor costs and internal memos in the file.
 *
 * This mirrors the (correct) on-screen preview logic so PDF/CSV exports
 * can't diverge from it again. 'statement' (internal) and 'vendor_statement'
 * (that vendor's own cost lines) still get the real items — only
 * 'invoice'/'client_statement' get the customer-safe synthetic lines.
 */
import type { CostItem, CostStatement, Shipment } from "../types";
import {
  deriveCustomerSummary,
  resolveCustomerReceivedAmount,
  type CustomerPaymentStatus,
  type ExpensePaymentStatus,
} from "./costStatementMath";

export type CostStatementExportMode = "statement" | "invoice" | "client_statement" | "vendor_statement";

const CUSTOMER_SAFE_SUPPLIER = "MARAS GROUP";

function buildInvoiceItems(
  statement: Pick<CostStatement, "currency" | "agreedCurrency">,
  shipment: Pick<Shipment, "agreedAmount" | "freightType"> | undefined
): CostItem[] {
  const amount = shipment?.agreedAmount || 0;
  const currency = statement.agreedCurrency || statement.currency;
  return [
    {
      id: "customer-safe-freight",
      costType: "Freight Charter",
      description: `Cross-Border Freight Logistics Charter Package (${(shipment?.freightType || "land").toUpperCase()})`,
      quantity: 1,
      unitPrice: amount,
      totalAmount: amount,
      currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
    {
      id: "customer-safe-customs",
      costType: "Customs Handling",
      description: "Border Custom Agency & Manifest Filing Security",
      quantity: 1,
      unitPrice: 0,
      totalAmount: 0,
      currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
  ];
}

function buildClientStatementItems(
  statement: Pick<CostStatement, "currency" | "customerReceivedAmount" | "shipmentNumber" | "agreedCurrency">,
  shipment: Pick<Shipment, "agreedAmount"> | undefined
): CostItem[] {
  const amount = shipment?.agreedAmount || 0;
  // Accounting Phase B: the ONLY payment a customer statement may show is
  // money RECEIVED FROM THE CUSTOMER (customerReceivedAmount). The
  // expense-side paidAmount — money MARAS paid toward vendors/costs — is
  // never read here and never presented as a customer receipt.
  const received = resolveCustomerReceivedAmount(statement);
  const currency = statement.agreedCurrency || statement.currency;
  const items: CostItem[] = [
    {
      id: "customer-safe-charter",
      costType: "Booking Charter",
      description: `Logistics Transport Booking Charter Agreed Amount - Agreement for shipment ${statement.shipmentNumber}`,
      quantity: 1,
      unitPrice: amount,
      totalAmount: amount,
      currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
  ];
  if (received > 0) {
    items.push({
      id: "customer-safe-payment",
      costType: "Payment Received",
      description: "Account Payment Received via Wire Transfer",
      quantity: 1,
      unitPrice: -received,
      totalAmount: -received,
      currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    });
  }
  return items;
}

/**
 * Cost line items safe to include in a PDF/CSV export for the given mode.
 * 'invoice'/'client_statement' never include a real CostItem (no vendor
 * name, no internal unit price, no internalNotes) — only synthetic,
 * customer-safe lines built from the shipment's agreedAmount.
 */
export function resolveExportItems(
  mode: CostStatementExportMode,
  statement: CostStatement,
  shipment: Pick<Shipment, "agreedAmount" | "freightType"> | undefined,
  selectedVendor?: string
): CostItem[] {
  const items = statement.items || [];
  if (mode === "invoice") return buildInvoiceItems(statement, shipment);
  if (mode === "client_statement") return buildClientStatementItems(statement, shipment);
  if (mode === "vendor_statement") return items.filter((item) => item.supplierName === selectedVendor);
  return items;
}

/**
 * Statement-level accounting notes are internal-only (see
 * CostStatement.notes) — never surfaced to a customer or vendor export.
 * Matches the on-screen preview, which only renders notes in 'statement'
 * mode.
 */
export function resolveExportNotes(mode: CostStatementExportMode, notes: string): string {
  return mode === "statement" ? notes : "";
}

/**
 * Accounting Phase B — the ONE mode-aware status rule shared by the
 * on-screen preview, the PDF, and the CSV so they can never drift:
 *
 *   statement (internal)  → the expense-side paymentStatus (paidAmount
 *                           vs totalCost). Internal eyes only.
 *   vendor_statement      → NO status. A statement-wide status is not
 *                           that vendor's information, and customer
 *                           payment data never belongs on a vendor doc.
 *   invoice / client      → the CUSTOMER-side status, derived from
 *                           customerReceivedAmount vs the shipment's
 *                           agreedAmount. The internal expense
 *                           paymentStatus must never appear here — an
 *                           invoice is not "PAID" because MARAS paid a
 *                           supplier.
 */
export type ExportHeaderStatus =
  | { kind: "expense"; value: ExpensePaymentStatus }
  | { kind: "customer"; value: CustomerPaymentStatus }
  | null;

export function resolveExportHeaderStatus(
  mode: CostStatementExportMode,
  statement: Pick<CostStatement, "paymentStatus" | "customerReceivedAmount">,
  shipment: Pick<Shipment, "agreedAmount"> | undefined
): ExportHeaderStatus {
  if (mode === "statement") return { kind: "expense", value: statement.paymentStatus };
  if (mode === "vendor_statement") return null;
  const summary = deriveCustomerSummary(
    shipment?.agreedAmount || 0,
    resolveCustomerReceivedAmount(statement)
  );
  return { kind: "customer", value: summary.customerStatus };
}
