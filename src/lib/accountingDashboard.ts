import type { CostStatement, CustomerInvoice, Currency } from "../types";
import { computeShipmentProfit } from "./costStatementMath";
import { resolveAccountingStatus } from "./costApprovalWorkflow";

/**
 * Pure view helpers for the Accounting Dashboard charts. KPI figures come from
 * the SERVER (GET /api/admin/dashboard/financial — authoritative, currency-safe);
 * these helpers only shape the records the accounting user already loads into
 * the trend + expense visualizations.
 *
 * Accounting Phase 1: monthly revenue and profit come ONLY from ISSUED customer
 * invoices (never the driver agreedAmount). Revenue = issued invoice total;
 * profit = issued invoice total − APPROVED cost. A shipment with no issued
 * invoice contributes nothing (honest, never fabricated), and profit is
 * recognized only when the invoice and cost currencies match.
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthlyPoint { key: string; label: string; revenue: number; profit: number }

/** Revenue vs profit for the trailing `months` calendar months (ending at nowIso). */
export function monthlyRevenueProfit(statements: CostStatement[], invoices: CustomerInvoice[], currency: Currency, nowIso: string, months = 6): MonthlyPoint[] {
  const now = new Date((nowIso || new Date().toISOString()).slice(0, 10) + "T00:00:00Z");
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const byKey = new Map<string, MonthlyPoint>(keys.map((k) => [k, { key: k, label: MONTHS[Number(k.slice(5, 7)) - 1], revenue: 0, profit: 0 }]));

  // Issued invoice total per shipmentNumber, in THIS currency only.
  const issuedTotal = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "paid") continue;
    if (inv.currency !== currency) continue;
    issuedTotal.set(inv.shipmentNumber, round2((issuedTotal.get(inv.shipmentNumber) || 0) + Number(inv.sellingAmount || 0)));
  }

  for (const st of statements) {
    const key = (st.date || "").slice(0, 7);
    const point = byKey.get(key);
    if (!point) continue;
    const invoiceTotal = issuedTotal.get(st.shipmentNumber);
    if (invoiceTotal === undefined) continue; // no issued invoice in this currency → nothing
    point.revenue = round2(point.revenue + invoiceTotal);
    const approved = resolveAccountingStatus(st as any) === "final_closed";
    const result = computeShipmentProfit({
      issuedInvoiceTotal: invoiceTotal,
      invoiceCurrency: currency,
      costsApproved: approved,
      approvedCostTotal: st.totalCost || 0,
      costCurrency: st.currency,
    });
    if (result.status === "available" && result.profit !== null) point.profit = round2(point.profit + result.profit);
  }
  return keys.map((k) => byKey.get(k)!);
}

export interface ExpenseSlice { category: string; amount: number; pct: number }

/** Expense totals grouped by cost-item type in one currency (top `top` + "Other"). */
export function expenseByCategory(statements: CostStatement[], currency: Currency, top = 6): ExpenseSlice[] {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const st of statements) {
    for (const item of (st.items || [])) {
      if (item.currency !== currency) continue;
      const cat = (item.costType || "Other").trim() || "Other";
      const amt = Number(item.totalAmount || 0);
      totals.set(cat, round2((totals.get(cat) || 0) + amt));
      grand = round2(grand + amt);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top);
  const slices: ExpenseSlice[] = head.map(([category, amount]) => ({ category, amount, pct: grand > 0 ? Math.round((amount / grand) * 100) : 0 }));
  if (rest.length) {
    const otherAmt = round2(rest.reduce((s, [, a]) => s + a, 0));
    slices.push({ category: "Other", amount: otherAmt, pct: grand > 0 ? Math.round((otherAmt / grand) * 100) : 0 });
  }
  return slices;
}

/** Latest `n` cost statements by date (newest first). */
export function recentStatements(statements: CostStatement[], n = 6): CostStatement[] {
  return [...statements].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, n);
}

/** Sum of item amounts in a currency (dashboard "total expenses" for the donut center). */
export function totalExpenses(statements: CostStatement[], currency: Currency): number {
  let grand = 0;
  for (const st of statements) for (const item of (st.items || [])) if (item.currency === currency) grand = round2(grand + Number(item.totalAmount || 0));
  return grand;
}
