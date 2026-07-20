import type { CustomerInvoice, CustomerPayment, VendorPaymentTransaction, CostStatement, CostItem, Currency } from "../types";
import { invoiceTotal } from "./accountingRegisters";
import { isOpenShipmentStatus } from "./executiveFinance";

/**
 * Simple Monthly Financial Report — pure, deterministic, currency-separated.
 * Every figure is derived from records the server already produced (issued
 * invoices, cost-statement items, active payments); nothing is invented and
 * currencies are never mixed. Revenue is recognised from issued invoices dated
 * in the month; expenses from cost-statement items dated in the month; closing
 * balances are the running position as of month-end (documents on/before the
 * last day minus settlements on/before the last day).
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const monthKeyOf = (iso: string | undefined): string => (iso || "").slice(0, 7);
const day = (iso: string | undefined): string => (iso || "").slice(0, 10);
const monthEnd = (monthKey: string): string => `${monthKey}-31`; // lexical upper bound for YYYY-MM-DD
const COUNTED = new Set(["issued", "partially_paid", "paid"]);
const invDate = (i: CustomerInvoice): string => i.invoiceDate || i.issuedAt || i.createdAt || "";

export interface MonthlyInput {
  invoices: CustomerInvoice[];
  customerPayments: CustomerPayment[];
  vendorPayments: VendorPaymentTransaction[];
  costStatements: CostStatement[];
  /** shipmentId -> shipment status, to classify completed vs open orders. */
  shipmentStatusById?: Record<string, string>;
}

export interface MonthlyFigures {
  currency: Currency;
  monthKey: string;
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  customerReceived: number;
  vendorPaid: number;
  closingReceivables: number;
  closingPayables: number;
  totalOrders: number;
  completedOrders: number;
  openOrders: number;
}

/** All currencies that appear in issued invoices or cost statements (sorted). */
export function reportCurrencies(invoices: CustomerInvoice[], costStatements: CostStatement[]): Currency[] {
  const set = new Set<string>();
  for (const i of invoices) if (COUNTED.has(i.status)) set.add(i.currency);
  for (const s of costStatements) set.add(s.currency);
  return [...set].sort() as Currency[];
}

/** Compute the monthly figures for one currency + YYYY-MM. */
export function computeMonthlyFigures(input: MonthlyInput, currency: Currency, monthKey: string): MonthlyFigures {
  const end = monthEnd(monthKey);
  let totalRevenue = 0, totalExpenses = 0, customerReceived = 0, vendorPaid = 0;
  let closingReceivables = 0, closingPayables = 0;

  for (const inv of input.invoices) {
    if (inv.currency !== currency || !COUNTED.has(inv.status)) continue;
    const d = day(invDate(inv));
    if (monthKeyOf(d) === monthKey) totalRevenue = round2(totalRevenue + invoiceTotal(inv));
    if (d && d <= end) closingReceivables = round2(closingReceivables + invoiceTotal(inv));
  }
  for (const p of input.customerPayments) {
    if (p.currency !== currency || p.status !== "active") continue;
    const d = day(p.paymentDate);
    if (monthKeyOf(d) === monthKey) customerReceived = round2(customerReceived + Number(p.amount || 0));
    if (d && d <= end) closingReceivables = round2(closingReceivables - Number(p.amount || 0));
  }
  for (const st of input.costStatements) {
    const stDay = day(st.date || st.createdAt);
    const inMonth = monthKeyOf(stDay) === monthKey;
    const beforeEnd = stDay && stDay <= end;
    for (const it of ((st.items as CostItem[]) || [])) {
      if (it.currency !== currency) continue;
      const amt = Number(it.totalAmount || 0);
      if (inMonth) totalExpenses = round2(totalExpenses + amt);
      if (beforeEnd) closingPayables = round2(closingPayables + amt);
    }
  }
  for (const v of input.vendorPayments) {
    if (v.currency !== currency || v.status !== "active") continue;
    const d = day(v.paymentDate);
    if (monthKeyOf(d) === monthKey) vendorPaid = round2(vendorPaid + Number(v.amount || 0));
    if (d && d <= end) closingPayables = round2(closingPayables - Number(v.amount || 0));
  }

  // Orders during the month = cost statements dated in the month for this currency.
  let totalOrders = 0, completedOrders = 0;
  for (const st of input.costStatements) {
    if (st.currency !== currency) continue;
    if (monthKeyOf(day(st.date || st.createdAt)) !== monthKey) continue;
    totalOrders += 1;
    const status = input.shipmentStatusById?.[st.shipmentId];
    const completed = status ? !isOpenShipmentStatus(status) : ((st as any).accountingStatus === "final_closed");
    if (completed) completedOrders += 1;
  }

  return {
    currency, monthKey,
    totalRevenue, totalExpenses, grossProfit: round2(totalRevenue - totalExpenses),
    customerReceived, vendorPaid,
    closingReceivables: round2(Math.max(0, closingReceivables)),
    closingPayables: round2(Math.max(0, closingPayables)),
    totalOrders, completedOrders, openOrders: totalOrders - completedOrders,
  };
}

export interface Delta { current: number; previous: number; amount: number; pct: number | null }
export function delta(current: number, previous: number): Delta {
  const amount = round2(current - previous);
  const pct = Math.abs(previous) > 0.005 ? round2((amount / Math.abs(previous)) * 100) : null;
  return { current: round2(current), previous: round2(previous), amount, pct };
}

export interface MonthlyComparison { revenue: Delta; expenses: Delta; profit: Delta }
export function monthlyComparison(cur: MonthlyFigures, prev: MonthlyFigures): MonthlyComparison {
  return {
    revenue: delta(cur.totalRevenue, prev.totalRevenue),
    expenses: delta(cur.totalExpenses, prev.totalExpenses),
    profit: delta(cur.grossProfit, prev.grossProfit),
  };
}

/** The previous calendar month key for a YYYY-MM. */
export function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m - 1) - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface RankRow { name: string; amount: number }

/** Top N customers by issued-invoice revenue in the month + currency. */
export function topCustomersByRevenue(invoices: CustomerInvoice[], currency: Currency, monthKey: string, n = 5): RankRow[] {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.currency !== currency || !COUNTED.has(inv.status)) continue;
    if (monthKeyOf(day(invDate(inv))) !== monthKey) continue;
    map.set(inv.companyName, round2((map.get(inv.companyName) || 0) + invoiceTotal(inv)));
  }
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Top N expense categories (cost-item type) in the month + currency. */
export function topExpenseCategories(costStatements: CostStatement[], currency: Currency, monthKey: string, n = 5): RankRow[] {
  const map = new Map<string, number>();
  for (const st of costStatements) {
    if (monthKeyOf(day(st.date || st.createdAt)) !== monthKey) continue;
    for (const it of ((st.items as CostItem[]) || [])) {
      if (it.currency !== currency) continue;
      const cat = (it.costType || "Other").trim() || "Other";
      map.set(cat, round2((map.get(cat) || 0) + Number(it.totalAmount || 0)));
    }
  }
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, n);
}
