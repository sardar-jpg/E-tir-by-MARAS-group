import type { CustomerInvoice, CustomerPayment, VendorPaymentTransaction, Currency } from "../types";

/**
 * Pure presentation aggregations for the Customer Invoices and Payments pages.
 * These NEVER compute or alter an accounting figure — they only tally and
 * bucket values the server already produced (invoice totals, payment amounts),
 * per currency, so a page can show KPI tiles without any cross-currency mixing.
 * All money is grouped strictly by its own currency (no FX, matching the rest
 * of the accounting module).
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Customer-facing total for an invoice (line-based grandTotal wins, else sellingAmount). */
export function invoiceTotal(inv: CustomerInvoice): number {
  const t = Number.isFinite(inv.grandTotal as number) ? Number(inv.grandTotal) : Number(inv.sellingAmount || 0);
  return round2(t);
}

export interface InvoiceCurrencySummary {
  currency: Currency;
  invoiced: number;
  count: number;
  byStatus: Record<string, number>; // status -> count
  outstandingCount: number;          // issued + partially_paid
}

/** Per-currency invoice totals + status counts (cancelled invoices excluded from money). */
export function summarizeInvoices(invoices: CustomerInvoice[]): InvoiceCurrencySummary[] {
  const map = new Map<string, InvoiceCurrencySummary>();
  for (const inv of invoices) {
    const cur = inv.currency;
    const s = map.get(cur) || { currency: cur, invoiced: 0, count: 0, byStatus: {}, outstandingCount: 0 };
    s.count += 1;
    s.byStatus[inv.status] = (s.byStatus[inv.status] || 0) + 1;
    if (inv.status !== "cancelled") s.invoiced = round2(s.invoiced + invoiceTotal(inv));
    if (inv.status === "issued" || inv.status === "partially_paid") s.outstandingCount += 1;
    map.set(cur, s);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export type CashDirection = "in" | "out";

export interface CashEntry {
  id: string;
  direction: CashDirection;
  date: string;
  party: string;          // customer company or vendor name
  method: string;
  reference: string;
  currency: Currency;
  amount: number;         // always positive; direction carries the sign meaning
  status: "active" | "reversed";
  allocationsCount: number; // customer: # invoices covered; vendor: 0
  orderRef?: string;     // vendor payments carry the MAR order
}

/** Flatten customer (inflow) + vendor (outflow) payments into one cash register stream. */
export function buildCashRegister(customer: CustomerPayment[], vendor: VendorPaymentTransaction[]): CashEntry[] {
  const rows: CashEntry[] = [];
  for (const p of customer) {
    rows.push({
      id: p.id, direction: "in", date: p.paymentDate || (p.createdAt || "").slice(0, 10),
      party: p.companyName, method: p.paymentMethod || "—", reference: p.reference || "",
      currency: p.currency, amount: round2(Number(p.amount || 0)), status: p.status,
      allocationsCount: (p.allocations || []).length,
    });
  }
  for (const v of vendor) {
    rows.push({
      id: v.id, direction: "out", date: v.paymentDate || (v.createdAt || "").slice(0, 10),
      party: v.vendorName, method: v.paymentMethod || "—", reference: v.reference || "",
      currency: v.currency, amount: round2(Number(v.amount || 0)), status: v.status,
      allocationsCount: 0, orderRef: v.shipmentNumber,
    });
  }
  return rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export interface CashCurrencySummary {
  currency: Currency;
  inflow: number;   // active customer receipts
  outflow: number;  // active vendor payments
  net: number;      // inflow - outflow
  count: number;    // active entries
}

/** Per-currency inflow / outflow / net from a register (reversed entries excluded from money). */
export function summarizeCash(entries: CashEntry[]): CashCurrencySummary[] {
  const map = new Map<string, CashCurrencySummary>();
  for (const e of entries) {
    const s = map.get(e.currency) || { currency: e.currency, inflow: 0, outflow: 0, net: 0, count: 0 };
    if (e.status === "active") {
      if (e.direction === "in") s.inflow = round2(s.inflow + e.amount);
      else s.outflow = round2(s.outflow + e.amount);
      s.net = round2(s.inflow - s.outflow);
      s.count += 1;
    }
    map.set(e.currency, s);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
