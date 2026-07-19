/**
 * customerInvoice.ts — pure, server-authoritative pricing + projection for
 * customer invoices. The selling amount is ALWAYS computed here from the
 * pricing mode + inputs (never trusted from the client), and the internal
 * cost/profit are kept out of the customer projection. No clock/db/session.
 *
 * Currency discipline (matches the rest of the accounting module): gross
 * profit is only computed when the invoice currency equals the cost-basis
 * currency; otherwise it is null (never a converted/mixed number).
 */
import type { CustomerInvoice, InvoicePricingMode, Currency } from "../types";

export const INVOICE_PRICING_MODES: readonly InvoicePricingMode[] = [
  "contract", "fixed_profit", "percentage_margin", "per_truck", "per_container", "per_service", "manual",
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface InvoicePricingInputs {
  costBasis: number;
  contractAmount?: number;
  fixedProfit?: number;
  marginPercent?: number;
  unitPrice?: number;
  unitQuantity?: number;
  manualAmount?: number;
}

export type InvoiceSellingResult =
  | { ok: true; sellingAmount: number }
  | { ok: false; code: string; error: string };

/**
 * Compute the customer-facing selling amount for a pricing mode. Cost-based
 * modes (fixed_profit, percentage_margin) add to the cost basis; per-unit
 * modes multiply; contract/manual take an explicit amount. Always ≥ 0.
 */
export function computeInvoiceSelling(mode: InvoicePricingMode, inputs: InvoicePricingInputs): InvoiceSellingResult {
  const cost = finite(inputs.costBasis) ?? 0;
  const nonNeg = (v: number) => (v >= 0 ? { ok: true as const, sellingAmount: round2(v) } : { ok: false as const, code: "negative", error: "Selling amount cannot be negative." });
  switch (mode) {
    case "contract": {
      const c = finite(inputs.contractAmount);
      if (c === null) return { ok: false, code: "missing_contract", error: "Contract amount is required for contract pricing." };
      return nonNeg(c);
    }
    case "fixed_profit": {
      const p = finite(inputs.fixedProfit);
      if (p === null) return { ok: false, code: "missing_profit", error: "A fixed profit amount is required." };
      return nonNeg(cost + p);
    }
    case "percentage_margin": {
      const m = finite(inputs.marginPercent);
      if (m === null) return { ok: false, code: "missing_margin", error: "A margin percentage is required." };
      return nonNeg(cost + cost * (m / 100));
    }
    case "per_truck":
    case "per_container":
    case "per_service": {
      const up = finite(inputs.unitPrice);
      const q = finite(inputs.unitQuantity);
      if (up === null || up < 0) return { ok: false, code: "missing_unit_price", error: "A valid unit price is required." };
      if (q === null || q <= 0) return { ok: false, code: "missing_quantity", error: "A valid quantity is required." };
      return nonNeg(up * q);
    }
    case "manual": {
      const a = finite(inputs.manualAmount);
      if (a === null) return { ok: false, code: "missing_manual", error: "A manual selling price is required." };
      return nonNeg(a);
    }
    default:
      return { ok: false, code: "invalid_mode", error: "Unknown pricing mode." };
  }
}

/**
 * Gross profit (PRIVATE) = selling − cost, only when currencies match.
 * Returns null when the cost currency differs from the invoice currency
 * (no FX) — surfaced honestly rather than as a misleading number.
 */
export function computeInvoiceGrossProfit(params: {
  sellingAmount: number;
  costBasis: number;
  invoiceCurrency: Currency;
  costCurrency: Currency;
}): number | null {
  if (params.invoiceCurrency !== params.costCurrency) return null;
  return round2(params.sellingAmount - params.costBasis);
}

/** A draft invoice can be edited; issued/cancelled are immutable. */
export function isInvoiceEditable(status: CustomerInvoice["status"]): boolean {
  return status === "draft";
}

export type InvoiceDecision = { ok: true } | { ok: false; code: string; error: string };

/**
 * Whether an invoice may be issued. Cost-derived pricing (fixed_profit /
 * percentage_margin) requires the internal cost to be signed off first
 * (the cost statement final_closed) — "after the cost is reviewed and
 * approved, add profit". Contract/manual/per-unit pricing don't depend on
 * cost and may be issued once the statement exists.
 */
export function canIssueInvoice(params: {
  status: CustomerInvoice["status"];
  pricingMode: InvoicePricingMode;
  costStatementStatus: string | undefined;
  sellingAmount: number;
}): InvoiceDecision {
  if (params.status !== "draft") return { ok: false, code: "not_draft", error: "Only a draft invoice can be issued." };
  if (!(params.sellingAmount > 0)) return { ok: false, code: "zero_amount", error: "The invoice amount must be greater than zero." };
  const costDerived = params.pricingMode === "fixed_profit" || params.pricingMode === "percentage_margin";
  if (costDerived && params.costStatementStatus !== "final_closed") {
    return { ok: false, code: "cost_not_approved", error: "Cost-based pricing requires the cost statement to be approved and closed first." };
  }
  return { ok: true };
}

export function canCancelInvoice(status: CustomerInvoice["status"], reason: string): InvoiceDecision {
  if (status !== "issued") return { ok: false, code: "not_issued", error: "Only an issued invoice can be cancelled." };
  if (!reason || !reason.trim()) return { ok: false, code: "reason_required", error: "A cancellation reason is required." };
  return { ok: true };
}

/**
 * Customer-facing projection — STRIPS every internal field (cost basis,
 * gross profit, internal notes, pricing inputs). This is the ONLY shape
 * that may reach a customer (PDF/statement). Amounts shown are the selling
 * total and the currency.
 */
export interface CustomerInvoiceView {
  invoiceNumber: string;
  shipmentNumber: string;
  companyName: string;
  currency: Currency;
  amount: number;
  description: string;
  notes: string;
  status: CustomerInvoiceStatusPublic;
  issuedAt?: string;
  bankAccountSnapshot?: CustomerInvoice["bankAccountSnapshot"];
}
type CustomerInvoiceStatusPublic = "issued" | "cancelled";

export function buildCustomerInvoiceView(inv: CustomerInvoice): CustomerInvoiceView {
  return {
    invoiceNumber: inv.invoiceNumber,
    shipmentNumber: inv.shipmentNumber,
    companyName: inv.companyName,
    currency: inv.currency,
    amount: inv.sellingAmount,
    description: inv.description || "",
    notes: inv.notes || "",
    status: inv.status === "cancelled" ? "cancelled" : "issued",
    issuedAt: inv.issuedAt,
    bankAccountSnapshot: inv.bankAccountSnapshot,
  };
}

/** Derive the invoice number from the MAR order number (no second system). */
export function buildInvoiceNumber(shipmentNumber: string, sequenceForShipment: number): string {
  return sequenceForShipment <= 1 ? shipmentNumber : `${shipmentNumber}/${sequenceForShipment}`;
}
