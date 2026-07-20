/**
 * customerInvoiceLines.ts — pure, SERVER-AUTHORITATIVE computation and
 * validation for customer-invoice service lines and totals.
 *
 * The browser may show a preview, but the server calls these functions on save
 * to recompute every line `amount` (quantity × unitPrice) and all invoice
 * totals — a browser-supplied `amount` / `grandTotal` is never trusted. Nothing
 * here reads or emits vendor cost or internal profit. No clock / db / session.
 */
import type { CustomerInvoiceLine } from "../types";
import { isOtherServiceType, isOtherUnit } from "./invoiceLineCatalog";

const round2 = (n: number): number => Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface InvoiceTotalsInput {
  discountAmount?: number;
  taxAmount?: number;
  additionalCharges?: number;
}
export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  additionalCharges: number;
  grandTotal: number;
}

/** Line amount is ALWAYS quantity × unitPrice, rounded to 2dp. */
export function computeLineAmount(quantity: number, unitPrice: number): number {
  const q = finite(quantity) ?? 0;
  const p = finite(unitPrice) ?? 0;
  return round2(q * p);
}

export type LineResult =
  | { ok: true; line: CustomerInvoiceLine }
  | { ok: false; code: string; error: string };

/**
 * Validate + normalize ONE raw line into a persisted CustomerInvoiceLine with a
 * server-recomputed amount. Description is optional; a custom service/unit is
 * required only when the corresponding value is the "Other" sentinel.
 */
export function sanitizeInvoiceLine(raw: any, id: string): LineResult {
  const serviceType = typeof raw?.serviceType === "string" ? raw.serviceType.trim() : "";
  if (!serviceType) return { ok: false, code: "missing_service_type", error: "A service type is required for every line." };
  const customServiceType = typeof raw?.customServiceType === "string" ? raw.customServiceType.trim() : "";
  if (isOtherServiceType(serviceType) && !customServiceType) return { ok: false, code: "missing_custom_service", error: "Specify the custom service type." };

  // Unit is OPTIONAL (removed from the invoice-line UI). Legacy lines may still
  // carry a unit; when present, an "Other" unit still needs its custom text.
  const unit = typeof raw?.unit === "string" ? raw.unit.trim() : "";
  const customUnit = typeof raw?.customUnit === "string" ? raw.customUnit.trim() : "";
  if (unit && isOtherUnit(unit) && !customUnit) return { ok: false, code: "missing_custom_unit", error: "Specify the custom unit." };

  const quantity = finite(raw?.quantity);
  if (quantity === null || !(quantity > 0)) return { ok: false, code: "invalid_quantity", error: "Quantity must be greater than zero." };
  const unitPrice = finite(raw?.unitPrice);
  if (unitPrice === null || unitPrice < 0) return { ok: false, code: "invalid_unit_price", error: "Unit price must be zero or greater." };

  const line: CustomerInvoiceLine = {
    id,
    serviceType: serviceType.slice(0, 80),
    quantity: round2(quantity),
    unitPrice: round2(unitPrice),
    // SERVER-AUTHORITATIVE: recomputed, never taken from the client.
    amount: computeLineAmount(quantity, unitPrice),
  };
  if (isOtherServiceType(serviceType)) line.customServiceType = customServiceType.slice(0, 80);
  if (unit) line.unit = unit.slice(0, 40);
  if (unit && isOtherUnit(unit)) line.customUnit = customUnit.slice(0, 40);
  const description = typeof raw?.description === "string" ? raw.description.trim() : "";
  if (description) line.description = description.slice(0, 300);
  return { ok: true, line };
}

export type LinesResult =
  | { ok: true; lines: CustomerInvoiceLine[] }
  | { ok: false; code: string; error: string };

/** Sanitize an array of raw lines; requires at least one valid line. */
export function sanitizeInvoiceLines(rawLines: unknown, idPrefix = "il"): LinesResult {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { ok: false, code: "no_lines", error: "At least one invoice line is required." };
  }
  const lines: CustomerInvoiceLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const r = sanitizeInvoiceLine(rawLines[i], `${idPrefix}-${i + 1}`);
    if (!r.ok) return r;
    lines.push(r.line);
  }
  return { ok: true, lines };
}

/**
 * Server-authoritative invoice totals from the (already recomputed) lines:
 *   subtotal   = Σ line.amount
 *   grandTotal = subtotal − discount + tax + additionalCharges
 * Negative adjustments are clamped so the grand total never goes below zero.
 */
export function computeInvoiceTotals(lines: CustomerInvoiceLine[], adj: InvoiceTotalsInput = {}): InvoiceTotals {
  const subtotal = round2((lines || []).reduce((s, l) => s + (finite(l.amount) ?? 0), 0));
  const discountAmount = round2(Math.max(0, finite(adj.discountAmount) ?? 0));
  const taxAmount = round2(Math.max(0, finite(adj.taxAmount) ?? 0));
  const additionalCharges = round2(Math.max(0, finite(adj.additionalCharges) ?? 0));
  const grandTotal = round2(Math.max(0, subtotal - discountAmount + taxAmount + additionalCharges));
  return { subtotal, discountAmount, taxAmount, additionalCharges, grandTotal };
}

/** True when the invoice carries structured service lines (vs a legacy total). */
export function hasInvoiceLines(inv: { invoiceLines?: unknown }): boolean {
  return Array.isArray(inv.invoiceLines) && inv.invoiceLines.length > 0;
}

/** The customer-facing label for a line (custom text wins for "Other"). */
export function lineServiceLabel(line: CustomerInvoiceLine): string {
  return isOtherServiceType(line.serviceType) ? (line.customServiceType || line.serviceType) : line.serviceType;
}
export function lineUnitLabel(line: CustomerInvoiceLine): string {
  if (!line.unit) return "";
  return isOtherUnit(line.unit) ? (line.customUnit || line.unit) : line.unit;
}
/** True when any line carries a unit (drives whether the PDF shows a Unit column). */
export function invoiceHasAnyUnit(lines: CustomerInvoiceLine[] | undefined): boolean {
  return Array.isArray(lines) && lines.some((l) => !!l.unit);
}

/** Signed difference of grand total vs the agreed shipment selling price. */
export function priceDifference(grandTotal: number, agreedAmount: number): number {
  return round2((finite(grandTotal) ?? 0) - (finite(agreedAmount) ?? 0));
}
