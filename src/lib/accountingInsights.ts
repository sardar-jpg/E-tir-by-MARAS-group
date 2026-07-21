import type { CostStatement, CustomerInvoice, Currency } from "../types";
import { computeShipmentProfit } from "./costStatementMath";
import { resolveAccountingStatus } from "./costApprovalWorkflow";
import type { ReceivableRow, PayableRow } from "./receivablesPayables";
import type { MonthlyFigures } from "./monthlyReport";

/**
 * Smart Financial Insights — DETERMINISTIC, explainable, rule-based. There is
 * no prediction or ML here: every card is produced by a transparent rule over
 * the accounting data the server already provides, so it can always be traced
 * back to real records. Currencies are never mixed; each insight's impact
 * carries its own currency. Honest `kind` labels distinguish a rule-based
 * insight, a trend observation, a recommended action, and the executive summary.
 */
export type InsightPriority = "critical" | "high" | "medium" | "info";
export type InsightKind = "summary" | "rule" | "trend" | "action";
export type LinkKind = "customer" | "vendor" | "order" | "invoice" | "payment";

export interface InsightLink { kind: LinkKind; label: string; tab: string; ref?: string }
export interface Insight {
  id: string;
  category: string;
  title: string;
  detail: string;
  impact?: { amount: number; currency: Currency };
  priority: InsightPriority;
  kind: InsightKind;
  link?: InsightLink;
}

const PRIORITY_ORDER: Record<InsightPriority, number> = { critical: 0, high: 1, medium: 2, info: 3 };
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const DUE_SOON_DAYS = 7;
const LOW_MARGIN = 0.05;
const EXPENSE_GROWTH = 0.25;

export interface InsightInput {
  receivables: ReceivableRow[];
  payables: PayableRow[];
  costStatements: CostStatement[];
  /**
   * Issued customer invoices (Accounting Phase 1). Profit/margin insights use
   * ONLY the issued invoice total minus the approved cost — never agreedAmount.
   * Absent/empty means no shipment has profit yet (all pending).
   */
  customerInvoices?: CustomerInvoice[];
  /** Per-currency current + previous month figures (optional trend source). */
  monthly?: { currency: Currency; current: MonthlyFigures; previous: MonthlyFigures }[];
}

/** Build the full, priority-sorted insight set from the accounting data. */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];

  // 1) Executive Financial Summary — one per currency (never merged).
  const currencies = new Set<string>([...input.receivables.map((r) => r.currency), ...input.payables.map((p) => p.currency)]);
  for (const cur of [...currencies].sort()) {
    const recOut = round2(input.receivables.filter((r) => r.currency === cur).reduce((s, r) => s + r.outstanding, 0));
    const recOver = round2(input.receivables.filter((r) => r.currency === cur).reduce((s, r) => s + r.overdueAmount, 0));
    const payOut = round2(input.payables.filter((p) => p.currency === cur).reduce((s, p) => s + p.outstanding, 0));
    const payOver = round2(input.payables.filter((p) => p.currency === cur).reduce((s, p) => s + p.overdueAmount, 0));
    out.push({
      id: `summary-${cur}`, category: "Executive Financial Summary", kind: "summary",
      priority: recOver > 0.005 || payOver > 0.005 ? "medium" : "info",
      title: `${cur} position: ${recOut.toLocaleString()} receivable · ${payOut.toLocaleString()} payable`,
      detail: `Customers owe ${recOut.toLocaleString()} ${cur} (${recOver.toLocaleString()} overdue); MARAS owes vendors ${payOut.toLocaleString()} ${cur} (${payOver.toLocaleString()} overdue).`,
      impact: { amount: recOut, currency: cur as Currency },
    });
  }

  // 2) Overdue Customer Alerts.
  for (const r of input.receivables) {
    if (r.overdueAmount <= 0.005) continue;
    const severe = r.aging.d90plus > 0.005 || r.aging.d61_90 > 0.005;
    out.push({
      id: `ar-overdue-${r.customer}-${r.currency}`, category: "Overdue Customer", kind: "rule",
      priority: severe ? "critical" : "high",
      title: `${r.customer} — ${r.overdueAmount.toLocaleString()} ${r.currency} overdue`,
      detail: `Outstanding ${r.outstanding.toLocaleString()} ${r.currency}${r.oldestUnpaidDate ? `; oldest unpaid since ${r.oldestUnpaidDate}` : ""}. Follow up on payment.`,
      impact: { amount: r.overdueAmount, currency: r.currency },
      link: { kind: "customer", label: "Open Customer Statement", tab: "acct_customer_statements", ref: r.customer },
    });
  }

  // 3) Upcoming / overdue Vendor Payment Alerts.
  for (const p of input.payables) {
    if (p.overdueAmount > 0.005) {
      out.push({
        id: `ap-overdue-${p.vendor}-${p.currency}`, category: "Vendor Payment", kind: "rule", priority: "high",
        title: `${p.vendor} — ${p.overdueAmount.toLocaleString()} ${p.currency} payment overdue`,
        detail: `MARAS is past due to this vendor. Prepare funds and settle.`,
        impact: { amount: p.overdueAmount, currency: p.currency },
        link: { kind: "vendor", label: "Open Vendor Statement", tab: "acct_vendor_statements", ref: p.vendor },
      });
    } else if (p.status === "due_soon" && p.dueAmount > 0.005) {
      out.push({
        id: `ap-due-${p.vendor}-${p.currency}`, category: "Vendor Payment", kind: "action", priority: "medium",
        title: `${p.vendor} — ${p.dueAmount.toLocaleString()} ${p.currency} due soon`,
        detail: `A vendor payment is due within ${DUE_SOON_DAYS} days. Prepare funds.`,
        impact: { amount: p.dueAmount, currency: p.currency },
        link: { kind: "vendor", label: "Open Vendor Statement", tab: "acct_vendor_statements", ref: p.vendor },
      });
    }
  }

  // 4) Negative or Low-Profit Orders + 5) Missing Cost Warnings.
  //
  // Accounting Phase 1: profit/margin come ONLY from the issued customer
  // invoice minus the approved cost (computeShipmentProfit) — agreedAmount is
  // never used. A shipment with no issued invoice, or whose costs are not yet
  // approved, is "profit pending" and produces NO negative/low-profit alert.
  const issuedByShipment = new Map<string, { total: number; currency: Currency }>();
  for (const inv of input.customerInvoices || []) {
    if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "paid") continue;
    const amt = Number(inv.sellingAmount || 0);
    const prev = issuedByShipment.get(inv.shipmentNumber);
    if (!prev) issuedByShipment.set(inv.shipmentNumber, { total: amt, currency: inv.currency });
    else if (prev.currency === inv.currency) prev.total = round2(prev.total + amt);
    else prev.total = NaN; // mixed-currency issued invoices → profit unavailable
  }

  for (const st of input.costStatements) {
    const items = ((st.items as any[]) || []);
    const issued = issuedByShipment.get(st.shipmentNumber);
    const approved = resolveAccountingStatus(st as any) === "final_closed";

    // Missing costs: the customer was invoiced but no expenses were recorded.
    if (issued && items.length === 0) {
      out.push({
        id: `missing-cost-${st.shipmentNumber}`, category: "Missing Cost", kind: "rule", priority: "medium",
        title: `${st.shipmentNumber} — invoiced but no costs recorded`,
        detail: `This order has an issued customer invoice but no expenses on its cost statement. Record the shipment costs.`,
        link: { kind: "order", label: "Open Cost Statement", tab: "costs", ref: st.shipmentNumber },
      });
      continue;
    }

    const result = computeShipmentProfit({
      issuedInvoiceTotal: issued ? issued.total : null,
      invoiceCurrency: issued ? issued.currency : null,
      costsApproved: approved,
      approvedCostTotal: st.totalCost || 0,
      costCurrency: st.currency,
    });
    // Pending / unavailable → no profit alert at all (never a fabricated one).
    if (result.status !== "available" || result.profit === null || !result.currency) continue;
    const gp = result.profit;
    const cur = result.currency;
    const revenue = issued!.total;
    if (gp < -0.005) {
      out.push({
        id: `neg-profit-${st.shipmentNumber}`, category: "Negative Profit", kind: "rule", priority: "critical",
        title: `${st.shipmentNumber} — negative profit ${gp.toLocaleString()} ${cur}`,
        detail: `Approved costs exceed the issued invoice amount. Review pricing and expenses for this order.`,
        impact: { amount: gp, currency: cur },
        link: { kind: "order", label: "Open Cost Statement", tab: "costs", ref: st.shipmentNumber },
      });
    } else if (revenue > 0.005 && gp / revenue < LOW_MARGIN) {
      out.push({
        id: `low-profit-${st.shipmentNumber}`, category: "Low Profit", kind: "rule", priority: "high",
        title: `${st.shipmentNumber} — thin margin (${round2((gp / revenue) * 100)}%)`,
        detail: `Profit ${gp.toLocaleString()} ${cur} is below ${LOW_MARGIN * 100}% of the issued invoice amount.`,
        impact: { amount: gp, currency: cur },
        link: { kind: "order", label: "Open Cost Statement", tab: "costs", ref: st.shipmentNumber },
      });
    }
  }

  // 6) Unpaid Invoice Risk — customers with outstanding and nothing received at all.
  for (const r of input.receivables) {
    if (r.outstanding > 0.005 && r.totalReceived <= 0.005 && r.overdueAmount <= 0.005) {
      out.push({
        id: `unpaid-${r.customer}-${r.currency}`, category: "Unpaid Invoice Risk", kind: "rule", priority: "medium",
        title: `${r.customer} — ${r.outstanding.toLocaleString()} ${r.currency} invoiced, nothing received`,
        detail: `No payment has been received yet against this customer's invoices. Monitor before it becomes overdue.`,
        impact: { amount: r.outstanding, currency: r.currency },
        link: { kind: "customer", label: "Open Customer Statement", tab: "acct_customer_statements", ref: r.customer },
      });
    }
  }

  // 7) Cash Position + 8) Expense-growth Trend observations.
  for (const m of input.monthly || []) {
    const net = round2(m.current.customerReceived - m.current.vendorPaid);
    out.push({
      id: `cash-${m.currency}`, category: "Cash Position", kind: "trend",
      priority: net < 0 ? "high" : "info",
      title: `${m.currency} net cash this month: ${net.toLocaleString()}`,
      detail: `Received ${m.current.customerReceived.toLocaleString()} ${m.currency}, paid ${m.current.vendorPaid.toLocaleString()} ${m.currency}. Closing receivables ${m.current.closingReceivables.toLocaleString()}, payables ${m.current.closingPayables.toLocaleString()}.`,
      impact: { amount: net, currency: m.currency },
    });
    if (m.previous.totalExpenses > 0.005) {
      const growth = (m.current.totalExpenses - m.previous.totalExpenses) / m.previous.totalExpenses;
      if (growth > EXPENSE_GROWTH) {
        out.push({
          id: `exp-growth-${m.currency}`, category: "Expense Growth", kind: "trend", priority: "medium",
          title: `${m.currency} expenses up ${round2(growth * 100)}% vs last month`,
          detail: `Expenses rose from ${m.previous.totalExpenses.toLocaleString()} to ${m.current.totalExpenses.toLocaleString()} ${m.currency}. Investigate the increase.`,
          impact: { amount: round2(m.current.totalExpenses - m.previous.totalExpenses), currency: m.currency },
        });
      }
    }
  }

  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || Math.abs(b.impact?.amount || 0) - Math.abs(a.impact?.amount || 0));
}

export interface InsightCounts { critical: number; high: number; medium: number; info: number; total: number }
export function countByPriority(insights: Insight[]): InsightCounts {
  const c: InsightCounts = { critical: 0, high: 0, medium: 0, info: 0, total: insights.length };
  for (const i of insights) c[i.priority] += 1;
  return c;
}
