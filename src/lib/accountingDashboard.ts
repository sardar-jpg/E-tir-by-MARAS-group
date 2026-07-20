import type { CostStatement, Currency } from "../types";
import { computeGrossProfit } from "./costStatementMath";

/**
 * Pure view helpers for the Accounting Dashboard charts. KPI figures come from
 * the SERVER (GET /api/admin/dashboard/financial — authoritative, currency-safe);
 * these helpers only shape the cost-statement records the accounting user
 * already loads into the trend + expense visualizations. Everything is real
 * data — a statement missing an agreed amount contributes 0 revenue (honest
 * undercount, never a fabricated figure) and profit is only recognized when
 * revenue and cost currencies match (computeGrossProfit decides).
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthlyPoint { key: string; label: string; revenue: number; profit: number }

/** Revenue vs profit for the trailing `months` calendar months (ending at nowIso). */
export function monthlyRevenueProfit(statements: CostStatement[], currency: Currency, nowIso: string, months = 6): MonthlyPoint[] {
  const now = new Date((nowIso || new Date().toISOString()).slice(0, 10) + "T00:00:00Z");
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const byKey = new Map<string, MonthlyPoint>(keys.map((k) => [k, { key: k, label: MONTHS[Number(k.slice(5, 7)) - 1], revenue: 0, profit: 0 }]));
  for (const st of statements) {
    const agreedCurrency = (st.agreedCurrency || st.currency) as Currency;
    if (agreedCurrency !== currency) continue;
    const key = (st.date || "").slice(0, 7);
    const point = byKey.get(key);
    if (!point) continue;
    const agreed = Number(st.agreedAmount ?? 0);
    point.revenue = round2(point.revenue + agreed);
    const profit = computeGrossProfit(agreed, agreedCurrency, st.totalCost || 0, st.currency);
    if (profit !== null) point.profit = round2(point.profit + profit);
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
