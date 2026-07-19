/**
 * customerPayments.ts — pure, server-authoritative logic for account-based
 * customer payments and their allocation to invoices.
 *
 * A customer (identified by company name) may hold many invoices and make
 * one payment covering several — or a partial amount, or an overpayment
 * (advance credit). Allocation is auto (oldest invoice first) or manual.
 * Per-invoice paid/outstanding and per-currency account totals are DERIVED
 * here from active (non-reversed) payments — never stored on the invoice.
 * No FX: a payment allocates only to invoices of the SAME currency.
 */
import type { CustomerInvoice, CustomerPayment, PaymentAllocation, Currency } from "../types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function isActivePayment(p: Pick<CustomerPayment, "status">): boolean {
  return p.status === "active";
}
/** Only issued, non-cancelled invoices are billable/allocatable. */
export function isBillableInvoice(inv: Pick<CustomerInvoice, "status">): boolean {
  return inv.status === "issued";
}

/** Total ACTIVE amount allocated to a given invoice across all payments. */
export function allocatedToInvoice(invoiceId: string, payments: CustomerPayment[]): number {
  let sum = 0;
  for (const p of payments) {
    if (!isActivePayment(p)) continue;
    for (const a of p.allocations || []) if (a.invoiceId === invoiceId) sum += Number.isFinite(a.amount) ? a.amount : 0;
  }
  return round2(sum);
}

export interface InvoiceOutstanding {
  invoiceId: string;
  invoiceNumber: string;
  currency: Currency;
  amount: number;
  paid: number;
  outstanding: number;
  issuedAt: string;
}

/** Outstanding-per-invoice for the billable invoices, oldest issued first. */
export function buildOutstandingList(invoices: CustomerInvoice[], payments: CustomerPayment[]): InvoiceOutstanding[] {
  return invoices
    .filter(isBillableInvoice)
    .map((inv) => {
      const paid = allocatedToInvoice(inv.id, payments);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        currency: inv.currency,
        amount: round2(inv.sellingAmount),
        paid,
        outstanding: round2(inv.sellingAmount - paid),
        issuedAt: inv.issuedAt || inv.createdAt || "",
      };
    })
    .sort((a, b) => (a.issuedAt || "").localeCompare(b.issuedAt || "") || a.invoiceId.localeCompare(b.invoiceId));
}

/**
 * Auto-allocate a payment amount to the oldest outstanding invoices of the
 * SAME currency, oldest first. Returns the allocations and any leftover
 * (advance credit). Never allocates more than an invoice's outstanding.
 */
export function autoAllocate(
  amount: number,
  currency: Currency,
  outstanding: InvoiceOutstanding[]
): { allocations: PaymentAllocation[]; unallocated: number } {
  let remaining = round2(amount);
  const allocations: PaymentAllocation[] = [];
  for (const o of outstanding) {
    if (remaining <= 0) break;
    if (o.currency !== currency || o.outstanding <= 0) continue;
    const alloc = round2(Math.min(remaining, o.outstanding));
    if (alloc > 0) {
      allocations.push({ invoiceId: o.invoiceId, invoiceNumber: o.invoiceNumber, amount: alloc });
      remaining = round2(remaining - alloc);
    }
  }
  return { allocations, unallocated: round2(remaining) };
}

export type AllocationValidation = { ok: true; allocations: PaymentAllocation[] } | { ok: false; code: string; error: string };

/**
 * Validate a manual allocation set against the payment and the invoices'
 * outstanding balances. Rules: each amount > 0; invoice exists, is billable,
 * and same currency; allocation ≤ invoice outstanding (excluding this
 * payment's prior allocation to it, so re-allocation is allowed); sum of
 * allocations ≤ payment amount (no negative unallocated).
 */
export function validateAllocations(params: {
  paymentId: string | null;
  paymentAmount: number;
  paymentCurrency: Currency;
  /**
   * Immutable identity of the paying customer. When provided (always, for new
   * writes), every targeted invoice MUST belong to the same clientId — a
   * payment can never be allocated to another customer's invoice, even if the
   * two customers share a display companyName. Optional only so legacy/pure
   * callers that pre-date customer isolation still type-check.
   */
  paymentClientId?: string;
  allocations: { invoiceId: string; amount: unknown }[];
  invoices: CustomerInvoice[];
  payments: CustomerPayment[];
}): AllocationValidation {
  const byId = new Map(params.invoices.map((i) => [i.id, i]));
  const result: PaymentAllocation[] = [];
  let total = 0;
  const seen = new Set<string>();
  const payerClientId = typeof params.paymentClientId === "string" ? params.paymentClientId.trim() : "";
  for (const a of params.allocations) {
    const inv = byId.get(a.invoiceId);
    if (!inv) return { ok: false, code: "invoice_not_found", error: "An allocation targets an invoice that does not exist." };
    if (!isBillableInvoice(inv)) return { ok: false, code: "invoice_not_billable", error: `Invoice ${inv.invoiceNumber} is not issued.` };
    // Cross-customer isolation (Phase 1): identity is by immutable clientId,
    // never companyName. Reject the moment a payer clientId is known and the
    // invoice's clientId differs (or the invoice has no resolvable identity).
    if (payerClientId) {
      const invClientId = typeof inv.clientId === "string" ? inv.clientId.trim() : "";
      if (!invClientId || invClientId !== payerClientId) {
        return { ok: false, code: "customer_mismatch", error: "Payment and invoice belong to different customers." };
      }
    }
    if (inv.currency !== params.paymentCurrency) return { ok: false, code: "currency_mismatch", error: `Invoice ${inv.invoiceNumber} is ${inv.currency}, payment is ${params.paymentCurrency}.` };
    if (seen.has(a.invoiceId)) return { ok: false, code: "duplicate_allocation", error: `Duplicate allocation to invoice ${inv.invoiceNumber}.` };
    seen.add(a.invoiceId);
    const amount = typeof a.amount === "number" && Number.isFinite(a.amount) ? round2(a.amount) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: "invalid_amount", error: "Each allocation amount must be positive." };
    // Outstanding available to THIS payment = invoice outstanding + what this
    // same payment already allocates to it (so editing its own split is fine).
    const otherPayments = params.payments.filter((p) => p.id !== params.paymentId);
    const availableOutstanding = round2(inv.sellingAmount - allocatedToInvoice(inv.id, otherPayments));
    if (amount > availableOutstanding) {
      return { ok: false, code: "over_invoice", error: `Allocation to ${inv.invoiceNumber} exceeds its outstanding balance (${availableOutstanding} ${inv.currency}).` };
    }
    total = round2(total + amount);
    result.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amount });
  }
  if (total > round2(params.paymentAmount)) {
    return { ok: false, code: "over_payment", error: "Total allocations exceed the payment amount." };
  }
  return { ok: true, allocations: result };
}

export function canReversePayment(payment: Pick<CustomerPayment, "status"> | null | undefined, reason: string): { ok: true } | { ok: false; code: string; error: string } {
  if (!payment) return { ok: false, code: "not_found", error: "Payment not found." };
  if (payment.status !== "active") return { ok: false, code: "not_active", error: "Only an active payment can be reversed." };
  if (!reason || !reason.trim()) return { ok: false, code: "reason_required", error: "A reversal reason is required." };
  return { ok: true };
}

export function isDuplicatePayment(
  existing: CustomerPayment[],
  candidate: { companyName: string; amount: number; paymentDate: string; reference?: string; currency: Currency }
): boolean {
  const ref = (candidate.reference || "").trim();
  return existing.some(
    (p) => isActivePayment(p) && p.companyName === candidate.companyName && p.currency === candidate.currency &&
      round2(p.amount) === round2(candidate.amount) && (p.paymentDate || "") === (candidate.paymentDate || "") && (p.reference || "").trim() === ref
  );
}

export interface CurrencyAccountSummary {
  currency: Currency;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  unallocatedCredit: number;
  openInvoiceCount: number;
}

/**
 * Per-currency account summary (never mixes currencies). invoicedTotal =
 * issued invoices; paidTotal = active allocations; outstandingTotal =
 * invoiced − paid; unallocatedCredit = active payments' amounts not yet
 * allocated (advance credit the customer holds).
 */
export function summarizeCustomerAccount(invoices: CustomerInvoice[], payments: CustomerPayment[]): CurrencyAccountSummary[] {
  const map = new Map<Currency, CurrencyAccountSummary>();
  const bucket = (c: Currency): CurrencyAccountSummary => {
    let b = map.get(c);
    if (!b) { b = { currency: c, invoicedTotal: 0, paidTotal: 0, outstandingTotal: 0, unallocatedCredit: 0, openInvoiceCount: 0 }; map.set(c, b); }
    return b;
  };
  for (const inv of invoices) {
    if (!isBillableInvoice(inv)) continue;
    const b = bucket(inv.currency);
    const paid = allocatedToInvoice(inv.id, payments);
    b.invoicedTotal = round2(b.invoicedTotal + inv.sellingAmount);
    b.paidTotal = round2(b.paidTotal + paid);
    if (round2(inv.sellingAmount - paid) > 0) b.openInvoiceCount += 1;
  }
  for (const p of payments) {
    if (!isActivePayment(p)) continue;
    const b = bucket(p.currency);
    const allocated = round2((p.allocations || []).reduce((s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0), 0));
    b.unallocatedCredit = round2(b.unallocatedCredit + Math.max(0, round2(p.amount - allocated)));
  }
  for (const b of map.values()) b.outstandingTotal = round2(b.invoicedTotal - b.paidTotal);
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
