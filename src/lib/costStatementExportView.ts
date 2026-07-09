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

export type CostStatementExportMode = "statement" | "invoice" | "client_statement" | "vendor_statement";

const CUSTOMER_SAFE_SUPPLIER = "MARAS GROUP";

function buildInvoiceItems(
  statement: Pick<CostStatement, "currency">,
  shipment: Pick<Shipment, "agreedAmount" | "freightType"> | undefined
): CostItem[] {
  const amount = shipment?.agreedAmount || 0;
  return [
    {
      id: "customer-safe-freight",
      costType: "Freight Charter",
      description: `Cross-Border Freight Logistics Charter Package (${(shipment?.freightType || "land").toUpperCase()})`,
      quantity: 1,
      unitPrice: amount,
      totalAmount: amount,
      currency: statement.currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
    {
      id: "customer-safe-customs",
      costType: "Customs Handling",
      description: "Border Custom Agency & Manifest Filing Security",
      quantity: 1,
      unitPrice: 0,
      totalAmount: 0,
      currency: statement.currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
  ];
}

function buildClientStatementItems(
  statement: Pick<CostStatement, "currency" | "paidAmount" | "shipmentNumber">,
  shipment: Pick<Shipment, "agreedAmount"> | undefined
): CostItem[] {
  const amount = shipment?.agreedAmount || 0;
  const paidAmount = statement.paidAmount || 0;
  const items: CostItem[] = [
    {
      id: "customer-safe-charter",
      costType: "Booking Charter",
      description: `Logistics Transport Booking Charter Agreed Amount - Agreement for shipment ${statement.shipmentNumber}`,
      quantity: 1,
      unitPrice: amount,
      totalAmount: amount,
      currency: statement.currency,
      supplierName: CUSTOMER_SAFE_SUPPLIER,
    },
  ];
  if (paidAmount > 0) {
    items.push({
      id: "customer-safe-payment",
      costType: "Payment Received",
      description: "Account Payment Received via Wire Transfer",
      quantity: 1,
      unitPrice: -paidAmount,
      totalAmount: -paidAmount,
      currency: statement.currency,
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
