/**
 * accountsReceivableOverview.ts — pure, per-currency AR summary for the
 * Admin Dashboard, derived from the REAL invoices + customer payments
 * (never AI, never mixed across currencies). Distinct from executiveFinance
 * (which recognizes revenue/profit on delivery from cost statements); this
 * is the customer receivables side: what has been invoiced, collected, and
 * is still outstanding, plus operational queues (drafts to issue, payments
 * to allocate).
 */
import type { CustomerInvoice, CustomerPayment, Currency } from "../types";
import { allocatedToInvoice } from "./customerPayments";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ArCurrencyOverview {
  currency: Currency;
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  advanceCredit: number;
  openInvoiceCount: number;
}

export interface ArOverview {
  currencies: ArCurrencyOverview[];
  /** Operational queues (currency-agnostic counts). */
  draftInvoiceCount: number;
  paymentsAwaitingAllocationCount: number;
}

/**
 * Build the AR overview. Only issued invoices and active payments count
 * toward money; drafts and unallocated payments are surfaced as work
 * queues. Collected = active allocations to issued invoices; advance credit
 * = active payment amounts not yet allocated.
 */
export function buildArOverview(invoices: CustomerInvoice[], payments: CustomerPayment[]): ArOverview {
  const map = new Map<Currency, ArCurrencyOverview>();
  const bucket = (c: Currency): ArCurrencyOverview => {
    let b = map.get(c);
    if (!b) { b = { currency: c, totalInvoiced: 0, totalCollected: 0, totalOutstanding: 0, advanceCredit: 0, openInvoiceCount: 0 }; map.set(c, b); }
    return b;
  };

  for (const inv of invoices) {
    // Issued-and-live invoices (issued / partially_paid / paid) are receivables.
    if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "paid") continue;
    const b = bucket(inv.currency);
    const paid = allocatedToInvoice(inv.id, payments);
    b.totalInvoiced = round2(b.totalInvoiced + inv.sellingAmount);
    b.totalCollected = round2(b.totalCollected + paid);
    if (round2(inv.sellingAmount - paid) > 0) b.openInvoiceCount += 1;
  }
  let paymentsAwaitingAllocationCount = 0;
  for (const p of payments) {
    if (p.status !== "active") continue;
    const b = bucket(p.currency);
    const allocated = round2((p.allocations || []).reduce((s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0), 0));
    const unallocated = round2(Math.max(0, p.amount - allocated));
    b.advanceCredit = round2(b.advanceCredit + unallocated);
    if (unallocated > 0) paymentsAwaitingAllocationCount += 1;
  }
  for (const b of map.values()) b.totalOutstanding = round2(b.totalInvoiced - b.totalCollected);

  return {
    currencies: [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    draftInvoiceCount: invoices.filter((i) => i.status === "draft").length,
    paymentsAwaitingAllocationCount,
  };
}
