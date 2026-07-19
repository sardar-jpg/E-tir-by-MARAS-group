/**
 * invoiceLedger.ts — deterministic, transaction-safe per-invoice allocation
 * ledger (PR #140 review increment 3, items 2–5).
 *
 * The ledger (invoiceAccountingLedgers/{invoiceId}) is a REBUILDABLE aggregate
 * of how much of an issued invoice has been allocated by active customer
 * payments. It is read + written INSIDE a Firestore transaction so Firestore —
 * not an in-process mutex — enforces the no-over-allocation invariant across
 * server instances. It never replaces the source payment records: those stay
 * authoritative and the ledger is always recomputable from them
 * (buildInvoiceLedger). Pure: no clock, db, or session.
 */
import type { Currency, CustomerInvoice, CustomerInvoiceStatus, CustomerPayment } from "../types";

export type InvoiceLedgerStatus = "open" | "paid" | "cancelled";

/**
 * Derive the customer invoice lifecycle status from its ledger totals
 * (server-authoritative). draft and cancelled are terminal here and never
 * change from a ledger recalculation. Otherwise: zero allocated → issued,
 * partial → partially_paid, fully covered → paid. Over-allocation is prevented
 * upstream by the ledger, so allocated ≥ invoiced maps to paid.
 */
export function deriveInvoiceStatus(current: CustomerInvoiceStatus, invoicedAmount: number, allocatedAmount: number): CustomerInvoiceStatus {
  if (current === "cancelled") return "cancelled";
  if (current === "draft") return "draft";
  const inv = round2(invoicedAmount);
  const al = round2(allocatedAmount);
  if (al <= 0.001) return "issued";
  if (al + 0.001 < inv) return "partially_paid";
  return "paid";
}

export interface InvoiceAccountingLedger {
  id: string; // === invoiceId
  invoiceId: string;
  clientId: string;
  currency: Currency;
  invoicedAmount: number;
  allocatedAmount: number;
  status: InvoiceLedgerStatus;
  revision: number;
  updatedAt: string;
}

const round2 = (n: number): number => Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;

export function invoiceLedgerId(invoiceId: string): string {
  return invoiceId;
}

function statusFor(invoiced: number, allocated: number, cancelled: boolean): InvoiceLedgerStatus {
  if (cancelled) return "cancelled";
  return round2(allocated) >= round2(invoiced) && round2(invoiced) > 0 ? "paid" : "open";
}

/** Initialize a ledger from an issued/draft invoice (allocated starts at `allocatedAmount`). */
export function initInvoiceLedgerFromInvoice(invoice: CustomerInvoice, nowIso: string, allocatedAmount = 0): InvoiceAccountingLedger {
  const cancelled = invoice.status === "cancelled";
  const invoiced = round2(invoice.sellingAmount);
  const allocated = round2(allocatedAmount);
  return {
    id: invoice.id, invoiceId: invoice.id, clientId: invoice.clientId || "", currency: invoice.currency,
    invoicedAmount: invoiced, allocatedAmount: allocated, status: statusFor(invoiced, allocated, cancelled),
    revision: 1, updatedAt: nowIso,
  };
}

/** Rebuild a ledger from the invoice + all ACTIVE payments' allocations (source of truth). */
export function buildInvoiceLedger(invoice: CustomerInvoice, payments: CustomerPayment[], nowIso: string, revision?: number): InvoiceAccountingLedger {
  const allocated = round2(
    payments
      .filter((p) => p.status === "active")
      .reduce((s, p) => s + (p.allocations || []).filter((a) => a.invoiceId === invoice.id).reduce((t, a) => t + (Number.isFinite(a.amount) ? a.amount : 0), 0), 0)
  );
  const cancelled = invoice.status === "cancelled";
  const invoiced = round2(invoice.sellingAmount);
  return {
    id: invoice.id, invoiceId: invoice.id, clientId: invoice.clientId || "", currency: invoice.currency,
    invoicedAmount: invoiced, allocatedAmount: allocated, status: statusFor(invoiced, allocated, cancelled),
    revision: revision ?? 1, updatedAt: nowIso,
  };
}

/** Amount still allocatable against a ledger (0 for cancelled). */
export function availableToAllocate(ledger: InvoiceAccountingLedger): number {
  if (ledger.status === "cancelled") return 0;
  return round2(ledger.invoicedAmount - ledger.allocatedAmount);
}

export type LedgerAllocationResult =
  | { ok: true; ledgers: InvoiceAccountingLedger[] }
  | { ok: false; code: string; error: string };

/**
 * Validate + apply NET allocation deltas to their ledgers (pure). A positive
 * delta (adding allocation) requires same customer, same currency, non-cancelled
 * invoice, and must not exceed the invoice's remaining balance. A negative delta
 * (removing/reversing) just reduces the allocated amount (never below 0). Used by
 * both allocation replacement and reversal so every ledger update goes through
 * one validated path.
 */
export function applyAllocationDeltas(params: {
  payerClientId: string;
  currency: Currency;
  ledgersById: Map<string, InvoiceAccountingLedger>;
  deltas: Array<{ invoiceId: string; delta: number }>;
  nowIso: string;
}): LedgerAllocationResult {
  const out: InvoiceAccountingLedger[] = [];
  for (const d of params.deltas) {
    if (round2(d.delta) === 0) continue;
    const ledger = params.ledgersById.get(d.invoiceId);
    if (!ledger) return { ok: false, code: "invoice_not_found", error: "Allocation targets an invoice with no ledger." };
    if (d.delta > 0) {
      if (!ledger.clientId || ledger.clientId !== params.payerClientId) return { ok: false, code: "customer_mismatch", error: "Payment and invoice belong to different customers." };
      if (ledger.currency !== params.currency) return { ok: false, code: "currency_mismatch", error: `Invoice ${ledger.invoiceId} currency differs from the payment.` };
      if (ledger.status === "cancelled") return { ok: false, code: "invoice_not_billable", error: `Invoice ${ledger.invoiceId} is cancelled.` };
    }
    const next = round2(ledger.allocatedAmount + d.delta);
    if (next < -0.001) return { ok: false, code: "allocation_conflict", error: `Allocation for invoice ${ledger.invoiceId} would go negative.` };
    if (d.delta > 0 && next > round2(ledger.invoicedAmount) + 0.001) return { ok: false, code: "over_invoice", error: `Allocation exceeds invoice ${ledger.invoiceId} balance.` };
    const clamped = round2(Math.max(0, next));
    out.push({ ...ledger, allocatedAmount: clamped, status: statusFor(ledger.invoicedAmount, clamped, ledger.status === "cancelled"), revision: (ledger.revision || 1) + 1, updatedAt: params.nowIso });
  }
  return { ok: true, ledgers: out };
}

export interface AutoAllocationResult {
  allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number }>;
  ledgers: InvoiceAccountingLedger[];
  unallocated: number;
}

/**
 * Auto-allocate `amount` across candidate ledgers OLDEST-FIRST (deterministic).
 * Candidates must already be ordered and belong to the payer. Returns the
 * chosen allocations plus the updated ledgers to persist; leftover is advance
 * credit. Never allocates beyond an invoice's available balance.
 */
export function autoAllocateFromLedgers(params: {
  amount: number;
  currency: Currency;
  payerClientId: string;
  candidates: InvoiceAccountingLedger[];
  invoiceNumbers: Map<string, string>;
  nowIso: string;
}): AutoAllocationResult {
  let remaining = round2(params.amount);
  const allocations: AutoAllocationResult["allocations"] = [];
  const ledgers: InvoiceAccountingLedger[] = [];
  for (const l of params.candidates) {
    if (remaining <= 0) break;
    if (l.clientId !== params.payerClientId || l.currency !== params.currency || l.status === "cancelled") continue;
    const avail = availableToAllocate(l);
    if (avail <= 0) continue;
    const alloc = round2(Math.min(remaining, avail));
    if (alloc <= 0) continue;
    allocations.push({ invoiceId: l.invoiceId, invoiceNumber: params.invoiceNumbers.get(l.invoiceId) || l.invoiceId, amount: alloc });
    const next = round2(l.allocatedAmount + alloc);
    ledgers.push({ ...l, allocatedAmount: next, status: statusFor(l.invoicedAmount, next, false), revision: (l.revision || 1) + 1, updatedAt: params.nowIso });
    remaining = round2(remaining - alloc);
  }
  return { allocations, ledgers, unallocated: round2(remaining) };
}
