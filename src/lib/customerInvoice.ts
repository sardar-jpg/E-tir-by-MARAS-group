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
import type { CustomerInvoice, CustomerInvoiceStatus, InvoicePricingMode, InvoiceMarkupType, Currency } from "../types";

export const INVOICE_PRICING_MODES: readonly InvoicePricingMode[] = ["manual", "cost_plus"];
export const INVOICE_MARKUP_TYPES: readonly InvoiceMarkupType[] = ["percentage", "fixed"];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function isInvoicePricingMode(v: unknown): v is InvoicePricingMode {
  return v === "manual" || v === "cost_plus";
}

export interface InvoicePricingInputs {
  /** manual mode. */
  manualAmount?: number;
  /** cost_plus mode: the authorized internal cost base (server-supplied, never trusted from the browser). */
  costBaseAmount?: number;
  markupType?: InvoiceMarkupType;
  markupValue?: number;
}

/** The full, server-authoritative pricing breakdown persisted on the invoice. */
export interface InvoicePricing {
  costBaseAmount: number; // 0 for manual (internal cost is tracked separately as costBasis)
  markupType?: InvoiceMarkupType;
  markupValue?: number;
  markupAmount: number; // 0 for manual
  sellingAmount: number;
}

export type InvoicePricingResult =
  | { ok: true; pricing: InvoicePricing }
  | { ok: false; code: string; error: string };

/**
 * Compute the customer-facing selling amount + markup breakdown for a pricing
 * mode (server-authoritative — never trust a browser-supplied total).
 *
 *  manual:    sellingAmount = manualAmount (no markup, no cost exposure).
 *  cost_plus: markupAmount = percentage → costBaseAmount × markupValue / 100
 *                            fixed      → markupValue
 *             sellingAmount = costBaseAmount + markupAmount.
 */
export function computeInvoicePricing(mode: InvoicePricingMode, inputs: InvoicePricingInputs): InvoicePricingResult {
  if (mode === "manual") {
    const a = finite(inputs.manualAmount);
    if (a === null) return { ok: false, code: "missing_manual", error: "A manual selling amount is required." };
    if (a < 0) return { ok: false, code: "negative", error: "Selling amount cannot be negative." };
    return { ok: true, pricing: { costBaseAmount: 0, markupAmount: 0, sellingAmount: round2(a) } };
  }
  if (mode === "cost_plus") {
    const base = finite(inputs.costBaseAmount);
    if (base === null || base < 0) return { ok: false, code: "missing_cost_base", error: "A valid cost base amount is required for cost-plus pricing." };
    const type = inputs.markupType;
    if (type !== "percentage" && type !== "fixed") return { ok: false, code: "missing_markup_type", error: "A markup type (percentage or fixed) is required." };
    const value = finite(inputs.markupValue);
    if (value === null || value < 0) return { ok: false, code: "missing_markup_value", error: "A valid markup value is required." };
    const markupAmount = type === "percentage" ? round2(base * (value / 100)) : round2(value);
    const sellingAmount = round2(base + markupAmount);
    if (sellingAmount < 0) return { ok: false, code: "negative", error: "Selling amount cannot be negative." };
    return { ok: true, pricing: { costBaseAmount: round2(base), markupType: type, markupValue: round2(value), markupAmount, sellingAmount } };
  }
  return { ok: false, code: "invalid_mode", error: "Unknown pricing mode." };
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

/** A draft invoice can be edited; every other status is financially immutable. */
export function isInvoiceEditable(status: CustomerInvoiceStatus): boolean {
  return status === "draft";
}

/** Statuses that count as issued-and-live for receivables/allocation. */
export function isReceivableInvoiceStatus(status: CustomerInvoiceStatus): boolean {
  return status === "issued" || status === "partially_paid" || status === "paid";
}

/**
 * Accounting Phase 3 — the "active invoice" that financially locks a Cost
 * Statement. An ACTIVE invoice is one that is issued / partially_paid / paid
 * (NEVER a draft or a cancelled invoice). agreedAmount is irrelevant here.
 */
export function isActiveInvoiceStatus(status: CustomerInvoiceStatus): boolean {
  return isReceivableInvoiceStatus(status);
}

/** True when ANY related customer invoice is active (issued/partially_paid/paid). */
export function hasActiveCustomerInvoice(invoices: ReadonlyArray<{ status: CustomerInvoiceStatus }>): boolean {
  return invoices.some((i) => isActiveInvoiceStatus(i.status));
}
/** Statuses that can still receive (more) payment allocation. */
export function isAllocatableInvoiceStatus(status: CustomerInvoiceStatus): boolean {
  return status === "issued" || status === "partially_paid";
}

export type InvoiceDecision = { ok: true } | { ok: false; code: string; error: string };

/**
 * Whether an invoice may be issued. Accounting Phase 3: an invoice may be
 * issued ONLY after its cost statement is approved and closed (final_closed) —
 * for every pricing mode. This enforces the controlled-correction rule that a
 * NEW invoice can only follow a completed (re-)approval: while a statement is
 * reopened/editing, or still pending its (new) approval chain, no invoice may
 * be issued. (Previously only cost_plus required approval; manual did not.)
 */
export function canIssueInvoice(params: {
  status: CustomerInvoiceStatus;
  pricingMode: InvoicePricingMode;
  costStatementStatus: string | undefined;
  sellingAmount: number;
}): InvoiceDecision {
  if (params.status !== "draft") return { ok: false, code: "not_draft", error: "Only a draft invoice can be issued." };
  if (!(params.sellingAmount > 0)) return { ok: false, code: "zero_amount", error: "The invoice amount must be greater than zero." };
  if (params.costStatementStatus !== "final_closed") {
    return { ok: false, code: "cost_not_approved", error: "The cost statement must be approved and closed before an invoice can be issued." };
  }
  return { ok: true };
}

/**
 * Whether an invoice is in a cancellable lifecycle state (draft is deleted, not
 * cancelled; an already-cancelled invoice can't be re-cancelled). Whether it
 * currently has ACTIVE allocations is a separate ledger check enforced inside
 * the cancellation transaction (invoice_has_allocations).
 */
export function canCancelInvoice(status: CustomerInvoiceStatus, reason: string): InvoiceDecision {
  if (!reason || !reason.trim()) return { ok: false, code: "reason_required", error: "A cancellation reason is required." };
  if (!isReceivableInvoiceStatus(status)) return { ok: false, code: "not_cancellable", error: "Only an issued invoice can be cancelled." };
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
