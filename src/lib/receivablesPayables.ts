import type { CustomerInvoice, CustomerPayment, Currency } from "../types";
import type { InvoiceOutstanding } from "./customerPayments";
import { invoiceTotal } from "./accountingRegisters";

/**
 * Receivables & Payables — pure, deterministic, currency-separated aging and
 * status logic for the management overview page. It NEVER mixes currencies and
 * never invents a figure: it only ages and tallies the outstanding amounts the
 * server already produced (customer invoice outstanding, vendor bill vs paid).
 * Overdue is measured against each document's due date; there is no FX.
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86_400_000;
/** Whole days that `dueIso` is in the past relative to `nowIso` (0 or negative = not overdue). */
export function daysOverdue(dueIso: string | undefined, nowIso: string): number {
  if (!dueIso) return 0;
  const due = new Date(dueIso.slice(0, 10) + "T00:00:00Z").getTime();
  const now = new Date(nowIso.slice(0, 10) + "T00:00:00Z").getTime();
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.floor((now - due) / DAY);
}

export interface AgingBuckets { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }
export const EMPTY_AGING: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

/** One unsettled document: its still-owed amount, its due date and its origin date. */
export interface OpenItem { outstanding: number; dueDate?: string; docDate: string }

export type ArStatus = "paid" | "overdue" | "due_soon" | "partially_paid" | "current";

export interface Aged {
  aging: AgingBuckets;
  outstanding: number;
  dueAmount: number;      // current bucket — owed but not yet overdue
  overdueAmount: number;  // sum of the overdue buckets
  oldestDocDate: string | null;
  earliestDueDate: string | null;
}

/** Bucket a set of open items into an aging profile (currency is the caller's concern). */
export function ageOpenItems(items: OpenItem[], nowIso: string): Aged {
  const aging: AgingBuckets = { ...EMPTY_AGING };
  let outstanding = 0, oldestDoc: string | null = null, earliestDue: string | null = null;
  for (const it of items) {
    const amt = round2(Number(it.outstanding || 0));
    if (amt <= 0.005) continue;
    outstanding = round2(outstanding + amt);
    const d = daysOverdue(it.dueDate, nowIso);
    if (d <= 0) aging.current = round2(aging.current + amt);
    else if (d <= 30) aging.d1_30 = round2(aging.d1_30 + amt);
    else if (d <= 60) aging.d31_60 = round2(aging.d31_60 + amt);
    else if (d <= 90) aging.d61_90 = round2(aging.d61_90 + amt);
    else aging.d90plus = round2(aging.d90plus + amt);
    if (it.docDate && (!oldestDoc || it.docDate < oldestDoc)) oldestDoc = it.docDate;
    if (it.dueDate && (!earliestDue || it.dueDate < earliestDue)) earliestDue = it.dueDate;
  }
  const overdueAmount = round2(aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90plus);
  return { aging, outstanding, dueAmount: aging.current, overdueAmount, oldestDocDate: oldestDoc, earliestDueDate: earliestDue };
}

/** Derive the row status from its aged profile + how much has been settled. */
export function deriveStatus(a: Aged, settled: number, nowIso: string, dueSoonDays = 7): ArStatus {
  if (a.outstanding <= 0.005) return "paid";
  if (a.overdueAmount > 0.005) return "overdue";
  if (a.earliestDueDate) {
    const d = daysOverdue(a.earliestDueDate, nowIso); // negative = days until due
    if (d > -dueSoonDays && d <= 0) return "due_soon";
  }
  if (settled > 0.005) return "partially_paid";
  return "current";
}

export interface ReceivableRow {
  customer: string;
  currency: Currency;
  totalInvoiced: number;
  totalReceived: number;
  outstanding: number;
  dueAmount: number;
  overdueAmount: number;
  oldestUnpaidDate: string | null;
  aging: AgingBuckets;
  status: ArStatus;
}

export interface CustomerAccountInput {
  customer: string;
  invoices: CustomerInvoice[];
  outstanding: InvoiceOutstanding[];
  payments: CustomerPayment[];
}

const COUNTED = new Set(["issued", "partially_paid", "paid"]);

/** One receivable row per (customer, currency). Currencies are never merged. */
export function buildReceivableRows(inputs: CustomerAccountInput[], nowIso: string): ReceivableRow[] {
  const rows: ReceivableRow[] = [];
  for (const acc of inputs) {
    const invById = new Map(acc.invoices.map((i) => [i.id, i]));
    // Per-currency buckets
    const byCur = new Map<string, { invoiced: number; received: number; items: OpenItem[] }>();
    const bucket = (cur: string) => {
      let b = byCur.get(cur);
      if (!b) { b = { invoiced: 0, received: 0, items: [] }; byCur.set(cur, b); }
      return b;
    };
    for (const inv of acc.invoices) if (COUNTED.has(inv.status)) bucket(inv.currency).invoiced = round2(bucket(inv.currency).invoiced + invoiceTotal(inv));
    for (const p of acc.payments) if (p.status === "active") bucket(p.currency).received = round2(bucket(p.currency).received + Number(p.amount || 0));
    for (const o of acc.outstanding) {
      if (Number(o.outstanding || 0) <= 0.005) continue;
      const inv = invById.get(o.invoiceId);
      bucket(o.currency).items.push({
        outstanding: Number(o.outstanding || 0),
        dueDate: inv?.dueDate,
        docDate: (inv?.invoiceDate || inv?.issuedAt || o.issuedAt || "").slice(0, 10),
      });
    }
    for (const [cur, b] of byCur) {
      if (b.invoiced <= 0.005 && b.items.length === 0) continue;
      const aged = ageOpenItems(b.items, nowIso);
      rows.push({
        customer: acc.customer, currency: cur as Currency,
        totalInvoiced: b.invoiced, totalReceived: b.received, outstanding: aged.outstanding,
        dueAmount: aged.dueAmount, overdueAmount: aged.overdueAmount, oldestUnpaidDate: aged.oldestDocDate,
        aging: aged.aging, status: deriveStatus(aged, b.received, nowIso),
      });
    }
  }
  return rows.sort((a, b) => b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding || a.customer.localeCompare(b.customer));
}

export interface PayableRow {
  vendor: string;
  currency: Currency;
  totalBills: number;
  totalPaid: number;
  outstanding: number;
  dueAmount: number;
  overdueAmount: number;
  oldestUnpaidDate: string | null;
  aging: AgingBuckets;
  status: ArStatus;
}

/** A single vendor bill (cost line) with how much of it has already been paid. */
export interface VendorBillInput { vendor: string; currency: Currency; amount: number; paid: number; dueDate?: string; docDate: string }

/** One payable row per (vendor, currency). Currencies are never merged. */
export function buildPayableRows(bills: VendorBillInput[], nowIso: string): PayableRow[] {
  const byKey = new Map<string, { vendor: string; currency: string; bills: number; paid: number; items: OpenItem[] }>();
  for (const bl of bills) {
    const key = `${bl.vendor}||${bl.currency}`;
    let b = byKey.get(key);
    if (!b) { b = { vendor: bl.vendor, currency: bl.currency, bills: 0, paid: 0, items: [] }; byKey.set(key, b); }
    b.bills = round2(b.bills + Number(bl.amount || 0));
    b.paid = round2(b.paid + Number(bl.paid || 0));
    const outstanding = round2(Number(bl.amount || 0) - Number(bl.paid || 0));
    if (outstanding > 0.005) b.items.push({ outstanding, dueDate: bl.dueDate, docDate: (bl.docDate || "").slice(0, 10) });
  }
  const rows: PayableRow[] = [];
  for (const b of byKey.values()) {
    const aged = ageOpenItems(b.items, nowIso);
    rows.push({
      vendor: b.vendor, currency: b.currency as Currency,
      totalBills: b.bills, totalPaid: b.paid, outstanding: aged.outstanding,
      dueAmount: aged.dueAmount, overdueAmount: aged.overdueAmount, oldestUnpaidDate: aged.oldestDocDate,
      aging: aged.aging, status: deriveStatus(aged, b.paid, nowIso),
    });
  }
  return rows.sort((a, b) => b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding || a.vendor.localeCompare(b.vendor));
}

export interface ArSummary { currency: Currency; totalOutstanding: number; totalOverdue: number; aging: AgingBuckets }

/** Per-currency roll-up of outstanding + overdue + aging (never merges currencies). */
export function summarizeAging(rows: { currency: Currency; outstanding: number; overdueAmount: number; aging: AgingBuckets }[]): ArSummary[] {
  const map = new Map<string, ArSummary>();
  for (const r of rows) {
    let s = map.get(r.currency);
    if (!s) { s = { currency: r.currency, totalOutstanding: 0, totalOverdue: 0, aging: { ...EMPTY_AGING } }; map.set(r.currency, s); }
    s.totalOutstanding = round2(s.totalOutstanding + r.outstanding);
    s.totalOverdue = round2(s.totalOverdue + r.overdueAmount);
    s.aging.current = round2(s.aging.current + r.aging.current);
    s.aging.d1_30 = round2(s.aging.d1_30 + r.aging.d1_30);
    s.aging.d31_60 = round2(s.aging.d31_60 + r.aging.d31_60);
    s.aging.d61_90 = round2(s.aging.d61_90 + r.aging.d61_90);
    s.aging.d90plus = round2(s.aging.d90plus + r.aging.d90plus);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface AgingFilter {
  query?: string;
  currency?: string;   // "" = all
  status?: string;     // "" = all
  due?: "all" | "due" | "overdue";
}

/** Filter receivable / payable rows (name, currency, status, due/overdue). */
export function filterAgingRows<T extends { currency: Currency; status: ArStatus; overdueAmount: number; dueAmount: number } & ({ customer: string } | { vendor: string })>(
  rows: T[], f: AgingFilter,
): T[] {
  const q = (f.query || "").trim().toLowerCase();
  return rows.filter((r) => {
    const name = ("customer" in r ? r.customer : (r as any).vendor) as string;
    if (f.currency && r.currency !== f.currency) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.due === "overdue" && r.overdueAmount <= 0.005) return false;
    if (f.due === "due" && r.dueAmount <= 0.005) return false;
    if (q && !name.toLowerCase().includes(q)) return false;
    return true;
  });
}
