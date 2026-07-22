/**
 * accountingReports.ts — Accounting Phase 7. Pure, deterministic, read-only
 * financial-reporting calculators built ON TOP of the authoritative Phase 1–6
 * records (cost statements, approved cost lines, customer invoices, customer
 * payments + allocations, vendor payments, financial-closing fields).
 *
 * Hard rules encoded here (never violated):
 *  - Currencies are NEVER combined and there is NO FX conversion. Every total
 *    is grouped by currency; there is no cross-currency grand total.
 *  - Official Profit = active issued customer invoice total − approved vendor
 *    cost total, per currency, and is NEVER affected by payment timing. It is
 *    a separate concept from Operational Cash Movement (receipts − payments).
 *  - Driver Agreed Amount is Reference Only and never appears in any official
 *    total here.
 *  - Reports never mutate anything — these are pure functions of already-loaded
 *    records. Inconsistent stored data surfaces as controlled warnings, never a
 *    silent repair and never a crash.
 *
 * The server loads the four collections once per request and calls these
 * builders; the same builders back the unit tests, so backend and tests agree.
 */
import type {
  Currency, CostStatement, CostItem, CustomerInvoice, CustomerPayment, VendorPaymentTransaction,
} from "../types";
import { summarizeInvoiceReceivable, isActivePayment as isActiveCustomerPayment } from "./customerPayments";
import { summarizeVendorPayable, isActivePayment as isActiveVendorPayment } from "./vendorPayments";
import { computeShipmentProfit, type ShipmentProfitStatus } from "./costStatementMath";
import { resolveAccountingStatus } from "./costApprovalWorkflow";
import { resolveFinancialStatus, type FinancialStatus } from "./financialClosing";

export const REPORT_EPS = 0.01;
export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100 + Number.EPSILON) / 100;
}
/** A reporting balance never goes below zero for presentation. */
export function clampNonNeg(n: number): number {
  const r = round2(n);
  return r < 0 ? 0 : r;
}

// ── Identity + status helpers ───────────────────────────────────────────────
/** The single order reference used everywhere (MAR-YYYY-NNN). */
export function orderRefOf(stmt: Pick<CostStatement, "shipmentNumber" | "shipmentId">): string {
  return stmt.shipmentNumber || stmt.shipmentId || "";
}
/** A cost line is officially APPROVED only when its statement is final_closed. */
export function isCostApproved(stmt: Pick<CostStatement, "accountingStatus">): boolean {
  return resolveAccountingStatus(stmt as any) === "final_closed";
}
/**
 * Stable vendor identity for grouping: prefer the explicit vendorId; otherwise
 * fall back to the (trimmed) supplier name so legacy lines without an id are
 * NEVER merged with a differently-named vendor. Distinct names stay distinct.
 */
export function vendorKeyOf(v: { vendorId?: string; supplierName?: string; vendorName?: string }): string {
  const id = (v.vendorId || "").trim();
  if (id) return `id:${id}`;
  const name = (v.supplierName || v.vendorName || "").trim();
  return name ? `name:${name.toLowerCase()}` : "name:(unnamed vendor)";
}
export function vendorDisplayName(v: { supplierName?: string; vendorName?: string }): string {
  return (v.supplierName || v.vendorName || "").trim() || "(Unnamed vendor)";
}

// ── Date helpers (UTC-day based, timezone-safe) ─────────────────────────────
const DAY = 86_400_000;
function toUtcDay(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z").getTime();
  return Number.isFinite(d) ? d : null;
}
/** Whole days `dueIso` is in the past relative to `asOfIso` (≤0 = not overdue). */
export function daysOverdue(dueIso: string | undefined, asOfIso: string): number {
  const due = toUtcDay(dueIso);
  const now = toUtcDay(asOfIso);
  if (due == null || now == null) return 0;
  return Math.floor((now - due) / DAY);
}
/** Inclusive [from,to] YYYY-MM-DD range test; empty bound = open on that side. */
export function withinRange(dateIso: string | undefined, from: string, to: string): boolean {
  const d = toUtcDay(dateIso);
  if (d == null) return !from && !to ? true : false;
  if (from) { const f = toUtcDay(from); if (f != null && d < f) return false; }
  if (to) { const t = toUtcDay(to); if (t != null && d > t) return false; }
  return true;
}

// ── Receivable aging ────────────────────────────────────────────────────────
export type AgingBucket =
  | "current_not_due" | "overdue_1_30" | "overdue_31_60" | "overdue_61_90"
  | "overdue_over_90" | "due_date_unavailable";
export const RECEIVABLE_AGING_BUCKETS: AgingBucket[] = [
  "current_not_due", "overdue_1_30", "overdue_31_60", "overdue_61_90", "overdue_over_90", "due_date_unavailable",
];

/**
 * Classify one open item into an aging bucket as of `asOfDate`. A zero (or
 * effectively zero) remaining amount is `current_not_due` and contributes
 * nothing to overdue totals. A missing due date is `due_date_unavailable`
 * (never invented from the issue date).
 */
export function calculateReceivableAging(input: { dueDate?: string; remainingAmount: number; asOfDate: string }):
  { bucket: AgingBucket; daysOverdue: number } {
  const remaining = round2(input.remainingAmount);
  if (remaining <= REPORT_EPS) return { bucket: "current_not_due", daysOverdue: 0 };
  if (!input.dueDate) return { bucket: "due_date_unavailable", daysOverdue: 0 };
  const d = daysOverdue(input.dueDate, input.asOfDate);
  if (d <= 0) return { bucket: "current_not_due", daysOverdue: 0 };
  if (d <= 30) return { bucket: "overdue_1_30", daysOverdue: d };
  if (d <= 60) return { bucket: "overdue_31_60", daysOverdue: d };
  if (d <= 90) return { bucket: "overdue_61_90", daysOverdue: d };
  return { bucket: "overdue_over_90", daysOverdue: d };
}

// ── Per-currency accumulation ───────────────────────────────────────────────
/** A currency-keyed map with a lazy bucket factory that never mixes currencies. */
export class CurrencyMap<T> {
  private m = new Map<Currency, T>();
  constructor(private readonly make: () => T) {}
  get(c: Currency): T {
    let b = this.m.get(c);
    if (!b) { b = this.make(); this.m.set(c, b); }
    return b;
  }
  has(c: Currency): boolean { return this.m.has(c); }
  currencies(): Currency[] { return [...this.m.keys()].sort(); }
  toObject(): Record<string, T> {
    const out: Record<string, T> = {};
    for (const c of this.currencies()) out[c] = this.m.get(c)!;
    return out;
  }
  entries(): Array<[Currency, T]> { return this.currencies().map((c) => [c, this.m.get(c)!] as [Currency, T]); }
}

// ── Order financial summary ─────────────────────────────────────────────────
export interface OrderCurrencyFigures {
  customerInvoiced: number;
  customerReceived: number;
  customerRemaining: number;
  vendorApproved: number;
  vendorPaid: number;
  vendorRemaining: number;
  /** Official profit for this currency, or null when not currently derivable. */
  officialProfit: number | null;
  profitStatus: ReportProfitStatus;
  /** Operational cash movement (received − paid). NOT profit. */
  netCashMovement: number;
}
export type ReportProfitStatus =
  | "available" | "pending_cost_approval" | "no_active_invoice"
  | "currency_mismatch" | "data_unavailable";

export interface OrderFinancialSummary {
  shipmentId: string;
  orderRef: string;
  customer: { id: string | null; name: string };
  costStatementStatus: string;
  financialStatus: FinancialStatus;
  currencies: Record<string, OrderCurrencyFigures>;
  counts: {
    activeInvoices: number; draftInvoices: number; cancelledInvoices: number;
    vendorCostLines: number; customerPayments: number; vendorPayments: number;
  };
  financialClosing: {
    status: FinancialStatus;
    closedAt: string | null; closedBy: string | null; closeReason: string | null;
    reopenedAt: string | null; reopenedBy: string | null;
    reopenCycleCount: number;
  };
  warnings: ReportWarning[];
}

export interface ReportWarning { code: string; message: string; ref?: string }

function newFigures(): OrderCurrencyFigures {
  return {
    customerInvoiced: 0, customerReceived: 0, customerRemaining: 0,
    vendorApproved: 0, vendorPaid: 0, vendorRemaining: 0,
    officialProfit: null, profitStatus: "data_unavailable", netCashMovement: 0,
  };
}

/**
 * Map a computeShipmentProfit status onto the report vocabulary. `pending_no_invoice`
 * → no_active_invoice; `pending_not_approved` → pending_cost_approval;
 * `unavailable_currency` → currency_mismatch.
 */
function profitStatusToReport(s: ShipmentProfitStatus): ReportProfitStatus {
  switch (s) {
    case "available": return "available";
    case "pending_no_invoice": return "no_active_invoice";
    case "pending_not_approved": return "pending_cost_approval";
    case "unavailable_currency": return "currency_mismatch";
    default: return "data_unavailable";
  }
}

/**
 * Build the read-only per-currency financial summary for ONE order.
 * `invoices` / `vendorPayments` must already be scoped to this shipment;
 * `customerPayments` is the full active+reversed set (the summarizer filters
 * by allocation). Nothing here changes any record.
 */
export function buildOrderFinancialSummary(params: {
  statement: CostStatement;
  invoices: CustomerInvoice[];
  customerPayments: CustomerPayment[];
  vendorPayments: VendorPaymentTransaction[];
  asOfDate: string;
}): OrderFinancialSummary {
  const { statement, invoices, customerPayments, vendorPayments } = params;
  const warnings: ReportWarning[] = [];
  const approved = isCostApproved(statement);
  const cur = new CurrencyMap<OrderCurrencyFigures>(newFigures);

  // Customer side — only active issued invoices count toward money.
  const activeInvoices = invoices.filter((i) => i.status === "issued" || i.status === "partially_paid" || i.status === "paid");
  for (const inv of activeInvoices) {
    const s = summarizeInvoiceReceivable(inv, customerPayments);
    const f = cur.get(inv.currency);
    f.customerInvoiced = round2(f.customerInvoiced + s.invoiceTotal);
    f.customerReceived = round2(f.customerReceived + s.paidAmount);
    const rem = round2(s.invoiceTotal - s.paidAmount);
    f.customerRemaining = clampNonNeg(f.customerRemaining + rem);
    if (rem < -REPORT_EPS) warnings.push({ code: "invoice_overpaid", message: "A customer payment allocation exceeds the invoice total.", ref: inv.invoiceNumber });
  }

  // Vendor side — approved cost lines only (final_closed statement).
  const items = (statement.items as CostItem[]) || [];
  if (approved) {
    for (const it of items) {
      const s = summarizeVendorPayable(it, vendorPayments);
      const f = cur.get(it.currency);
      f.vendorApproved = round2(f.vendorApproved + s.costAmount);
      f.vendorPaid = round2(f.vendorPaid + s.totalPaid);
      f.vendorRemaining = clampNonNeg(f.vendorRemaining + s.remaining);
      if (s.status === "Overpaid") warnings.push({ code: "vendor_overpaid", message: "A vendor payment exceeds the approved cost line.", ref: it.description || it.costType });
    }
  }

  // Official profit + operational cash movement, per currency.
  const invoiceCurrencies = new Set(activeInvoices.map((i) => i.currency));
  for (const [c, f] of cur.entries()) {
    const hasInvoice = invoiceCurrencies.has(c);
    const profit = computeShipmentProfit({
      issuedInvoiceTotal: hasInvoice ? f.customerInvoiced : null,
      invoiceCurrency: hasInvoice ? c : null,
      costsApproved: approved,
      approvedCostTotal: f.vendorApproved,
      costCurrency: approved ? c : null,
    });
    f.officialProfit = profit.profit;
    f.profitStatus = profitStatusToReport(profit.status);
    f.netCashMovement = round2(f.customerReceived - f.vendorPaid);
  }

  const financialStatus = resolveFinancialStatus(statement as any);
  return {
    shipmentId: statement.shipmentId,
    orderRef: orderRefOf(statement),
    customer: { id: null, name: statement.companyName || "" },
    costStatementStatus: resolveAccountingStatus(statement as any),
    financialStatus,
    currencies: cur.toObject(),
    counts: {
      activeInvoices: activeInvoices.length,
      draftInvoices: invoices.filter((i) => i.status === "draft").length,
      cancelledInvoices: invoices.filter((i) => i.status === "cancelled").length,
      vendorCostLines: items.length,
      customerPayments: customerPayments.filter((p) => isActiveCustomerPayment(p) && (p.allocations || []).some((a) => activeInvoices.some((i) => i.id === a.invoiceId))).length,
      vendorPayments: vendorPayments.filter((p) => isActiveVendorPayment(p)).length,
    },
    financialClosing: {
      status: financialStatus,
      closedAt: statement.financialClosedAt || null,
      closedBy: statement.financialClosedBy || null,
      closeReason: statement.financialCloseReason || null,
      reopenedAt: statement.financialReopenedAt || null,
      reopenedBy: statement.financialReopenedBy || null,
      reopenCycleCount: Array.isArray(statement.financialReopenCycles) ? statement.financialReopenCycles.length : 0,
    },
    warnings,
  };
}

// ── Accounts Receivable report ──────────────────────────────────────────────
export interface ReceivableRow {
  invoiceId: string; invoiceNumber: string; orderRef: string; shipmentId: string;
  customer: string; issueDate: string; dueDate: string | null; currency: Currency;
  invoiceAmount: number; receivedAmount: number; remainingAmount: number;
  invoiceStatus: string; daysOverdue: number; agingBucket: AgingBucket;
  financialStatus: FinancialStatus; lastPaymentDate: string | null;
}
export interface ReceivableCurrencyTotals {
  currency: Currency; invoiced: number; received: number; outstanding: number;
  overdue: number; notYetDue: number; invoiceCount: number; overdueInvoiceCount: number;
  aging: Record<AgingBucket, number>;
}
function emptyAging(): Record<AgingBucket, number> {
  return { current_not_due: 0, overdue_1_30: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_over_90: 0, due_date_unavailable: 0 };
}

const invoiceIssueDate = (i: CustomerInvoice): string => (i.issuedAt || i.invoiceDate || i.createdAt || "").slice(0, 10);
const lastActivePaymentDateForInvoice = (invoiceId: string, payments: CustomerPayment[]): string | null => {
  let latest: string | null = null;
  for (const p of payments) {
    if (!isActiveCustomerPayment(p)) continue;
    if (!(p.allocations || []).some((a) => a.invoiceId === invoiceId)) continue;
    const d = (p.paymentDate || p.createdAt || "").slice(0, 10);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
};

/**
 * Build the AR rows for ALL active issued invoices (draft + cancelled always
 * excluded). Each row is aged against its own due date as of `asOfDate`. The
 * caller supplies a per-shipment financialStatus lookup.
 */
export function buildReceivableRows(params: {
  invoices: CustomerInvoice[];
  customerPayments: CustomerPayment[];
  financialStatusByShipment: (shipmentId: string) => FinancialStatus;
  asOfDate: string;
}): ReceivableRow[] {
  const rows: ReceivableRow[] = [];
  for (const inv of params.invoices) {
    if (!(inv.status === "issued" || inv.status === "partially_paid" || inv.status === "paid")) continue;
    const s = summarizeInvoiceReceivable(inv, params.customerPayments);
    const remaining = clampNonNeg(s.remainingAmount);
    const aged = calculateReceivableAging({ dueDate: inv.dueDate, remainingAmount: remaining, asOfDate: params.asOfDate });
    rows.push({
      invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, orderRef: inv.shipmentNumber || inv.shipmentId,
      shipmentId: inv.shipmentId, customer: inv.companyName || "", issueDate: invoiceIssueDate(inv),
      dueDate: inv.dueDate || null, currency: inv.currency,
      invoiceAmount: s.invoiceTotal, receivedAmount: s.paidAmount, remainingAmount: remaining,
      invoiceStatus: inv.status, daysOverdue: aged.daysOverdue, agingBucket: aged.bucket,
      financialStatus: params.financialStatusByShipment(inv.shipmentId),
      lastPaymentDate: lastActivePaymentDateForInvoice(inv.id, params.customerPayments),
    });
  }
  return rows;
}

/** Group receivable rows into per-currency totals + aging (from the FULL filtered set). */
export function summarizeReceivables(rows: ReceivableRow[]): ReceivableCurrencyTotals[] {
  const cur = new CurrencyMap<ReceivableCurrencyTotals>(() => ({
    currency: "USD", invoiced: 0, received: 0, outstanding: 0, overdue: 0, notYetDue: 0,
    invoiceCount: 0, overdueInvoiceCount: 0, aging: emptyAging(),
  }));
  for (const r of rows) {
    const t = cur.get(r.currency); t.currency = r.currency;
    t.invoiced = round2(t.invoiced + r.invoiceAmount);
    t.received = round2(t.received + r.receivedAmount);
    t.outstanding = round2(t.outstanding + r.remainingAmount);
    t.invoiceCount += 1;
    t.aging[r.agingBucket] = round2(t.aging[r.agingBucket] + r.remainingAmount);
    const overdue = r.agingBucket !== "current_not_due" && r.agingBucket !== "due_date_unavailable";
    if (overdue) { t.overdue = round2(t.overdue + r.remainingAmount); t.overdueInvoiceCount += 1; }
    else t.notYetDue = round2(t.notYetDue + r.remainingAmount);
  }
  return cur.currencies().map((c) => cur.get(c));
}

// ── Accounts Payable report ─────────────────────────────────────────────────
export interface PayableRow {
  costLineId: string; description: string; orderRef: string; shipmentId: string;
  vendorKey: string; vendor: string; currency: Currency;
  approvedAmount: number; paidAmount: number; remainingAmount: number;
  paymentStatus: string; paymentCount: number; approvedDate: string | null; dueDate: string | null;
  financialStatus: FinancialStatus;
}
export interface PayableCurrencyTotals {
  currency: Currency; approved: number; paid: number; remaining: number;
  unpaidAmount: number; partiallyPaidAmount: number;
  paidLineCount: number; unpaidLineCount: number; partiallyPaidLineCount: number;
}
const payStatusLower = (s: string): "paid" | "partially_paid" | "unpaid" =>
  s === "Paid" ? "paid" : s === "Partially Paid" ? "partially_paid" : "unpaid";

/** Build AP rows from APPROVED (final_closed) statements' cost lines only. */
export function buildPayableRows(params: {
  statements: CostStatement[];
  vendorPaymentsByShipment: (shipmentId: string) => VendorPaymentTransaction[];
  asOfDate: string;
}): PayableRow[] {
  const rows: PayableRow[] = [];
  for (const stmt of params.statements) {
    if (!isCostApproved(stmt)) continue;
    const payments = params.vendorPaymentsByShipment(stmt.shipmentId);
    const financialStatus = resolveFinancialStatus(stmt as any);
    for (const it of (stmt.items as CostItem[]) || []) {
      const s = summarizeVendorPayable(it, payments);
      rows.push({
        costLineId: it.id, description: it.description || it.costType || "Vendor cost",
        orderRef: orderRefOf(stmt), shipmentId: stmt.shipmentId,
        vendorKey: vendorKeyOf(it), vendor: vendorDisplayName(it), currency: it.currency,
        approvedAmount: s.costAmount, paidAmount: s.totalPaid, remainingAmount: clampNonNeg(s.remaining),
        paymentStatus: payStatusLower(s.status), paymentCount: s.activePaymentCount,
        approvedDate: (stmt.finalizedAt || stmt.date || "").slice(0, 10) || null,
        dueDate: it.dueDate || null, financialStatus,
      });
    }
  }
  return rows;
}

export function summarizePayables(rows: PayableRow[]): PayableCurrencyTotals[] {
  const cur = new CurrencyMap<PayableCurrencyTotals>(() => ({
    currency: "USD", approved: 0, paid: 0, remaining: 0, unpaidAmount: 0, partiallyPaidAmount: 0,
    paidLineCount: 0, unpaidLineCount: 0, partiallyPaidLineCount: 0,
  }));
  for (const r of rows) {
    const t = cur.get(r.currency); t.currency = r.currency;
    t.approved = round2(t.approved + r.approvedAmount);
    t.paid = round2(t.paid + r.paidAmount);
    t.remaining = round2(t.remaining + r.remainingAmount);
    if (r.paymentStatus === "paid") t.paidLineCount += 1;
    else if (r.paymentStatus === "partially_paid") { t.partiallyPaidLineCount += 1; t.partiallyPaidAmount = round2(t.partiallyPaidAmount + r.remainingAmount); }
    else { t.unpaidLineCount += 1; t.unpaidAmount = round2(t.unpaidAmount + r.remainingAmount); }
  }
  return cur.currencies().map((c) => cur.get(c));
}

// ── Official Profit report ──────────────────────────────────────────────────
export interface ProfitRow {
  orderRef: string; shipmentId: string; customer: string;
  transportMode: string | null; currency: Currency;
  issuedInvoiceTotal: number; approvedVendorCost: number;
  officialProfit: number | null; profitStatus: ReportProfitStatus;
  costStatementStatus: string; financialStatus: FinancialStatus;
  latestInvoiceDate: string | null; financialCloseDate: string | null;
}

/** One profit row per (order, currency) where the order has invoice or approved cost. */
export function buildProfitRows(params: {
  statements: CostStatement[];
  invoicesByShipment: (shipmentId: string) => CustomerInvoice[];
  vendorPaymentsByShipment: (shipmentId: string) => VendorPaymentTransaction[];
  customerPayments: CustomerPayment[];
}): ProfitRow[] {
  const rows: ProfitRow[] = [];
  for (const stmt of params.statements) {
    const summary = buildOrderFinancialSummary({
      statement: stmt, invoices: params.invoicesByShipment(stmt.shipmentId),
      customerPayments: params.customerPayments, vendorPayments: params.vendorPaymentsByShipment(stmt.shipmentId),
      asOfDate: "",
    });
    const invoices = params.invoicesByShipment(stmt.shipmentId)
      .filter((i) => i.status === "issued" || i.status === "partially_paid" || i.status === "paid");
    const latestInvoiceDate = invoices.reduce<string | null>((acc, i) => {
      const d = invoiceIssueDate(i); return d && (!acc || d > acc) ? d : acc;
    }, null);
    for (const [c, f] of Object.entries(summary.currencies)) {
      rows.push({
        orderRef: summary.orderRef, shipmentId: stmt.shipmentId, customer: stmt.companyName || "",
        transportMode: stmt.shipmentType || null, currency: c as Currency,
        issuedInvoiceTotal: f.customerInvoiced, approvedVendorCost: f.vendorApproved,
        officialProfit: f.officialProfit, profitStatus: f.profitStatus,
        costStatementStatus: summary.costStatementStatus, financialStatus: summary.financialStatus,
        latestInvoiceDate, financialCloseDate: stmt.financialClosedAt || null,
      });
    }
  }
  return rows;
}

export interface ProfitCurrencyTotals { currency: Currency; issuedInvoiceTotal: number; approvedVendorCost: number; officialProfit: number; orderCount: number }
/** Per-currency profit totals — ONLY rows with an available profit contribute. */
export function summarizeProfit(rows: ProfitRow[]): ProfitCurrencyTotals[] {
  const cur = new CurrencyMap<ProfitCurrencyTotals>(() => ({ currency: "USD", issuedInvoiceTotal: 0, approvedVendorCost: 0, officialProfit: 0, orderCount: 0 }));
  for (const r of rows) {
    if (r.profitStatus !== "available" || r.officialProfit == null) continue;
    const t = cur.get(r.currency); t.currency = r.currency;
    t.issuedInvoiceTotal = round2(t.issuedInvoiceTotal + r.issuedInvoiceTotal);
    t.approvedVendorCost = round2(t.approvedVendorCost + r.approvedVendorCost);
    t.officialProfit = round2(t.officialProfit + r.officialProfit);
    t.orderCount += 1;
  }
  return cur.currencies().map((c) => cur.get(c));
}

// ── Customer Receipts report ────────────────────────────────────────────────
export interface CustomerReceiptRow {
  paymentId: string; paymentDate: string; customer: string; amount: number; currency: Currency;
  paymentMethod: string; reference: string | null; recordedBy: string | null; recordedAt: string | null;
  status: "active" | "reversed"; reversalReason: string | null;
  invoiceNumbers: string[]; orderRefs: string[];
}
export function buildCustomerReceiptRows(params: {
  payments: CustomerPayment[]; invoicesById: (id: string) => CustomerInvoice | undefined; includeReversed: boolean;
}): CustomerReceiptRow[] {
  const rows: CustomerReceiptRow[] = [];
  for (const p of params.payments) {
    if (!params.includeReversed && !isActiveCustomerPayment(p)) continue;
    const invoiceNumbers: string[] = []; const orderRefs: string[] = [];
    for (const a of p.allocations || []) {
      const inv = params.invoicesById(a.invoiceId);
      if (a.invoiceNumber) invoiceNumbers.push(a.invoiceNumber);
      if (inv?.shipmentNumber) orderRefs.push(inv.shipmentNumber);
    }
    rows.push({
      paymentId: p.id, paymentDate: (p.paymentDate || p.createdAt || "").slice(0, 10), customer: p.companyName || "",
      amount: round2(p.amount), currency: p.currency, paymentMethod: p.paymentMethod || "",
      reference: p.reference || null, recordedBy: p.createdBy || null, recordedAt: p.createdAt || null,
      status: p.status, reversalReason: p.status === "reversed" ? (p.reversalReason || null) : null,
      invoiceNumbers: [...new Set(invoiceNumbers)], orderRefs: [...new Set(orderRefs)],
    });
  }
  return rows;
}
export interface ReceiptCurrencyTotals { currency: Currency; active: number; reversed: number; count: number }
export function summarizeReceipts(rows: Array<{ currency: Currency; amount: number; status: "active" | "reversed" }>): ReceiptCurrencyTotals[] {
  const cur = new CurrencyMap<ReceiptCurrencyTotals>(() => ({ currency: "USD", active: 0, reversed: 0, count: 0 }));
  for (const r of rows) {
    const t = cur.get(r.currency); t.currency = r.currency; t.count += 1;
    if (r.status === "reversed") t.reversed = round2(t.reversed + r.amount);
    else t.active = round2(t.active + r.amount);
  }
  return cur.currencies().map((c) => cur.get(c));
}

// ── Vendor Payments report ──────────────────────────────────────────────────
export interface VendorPaymentRow {
  paymentId: string; vendor: string; vendorKey: string; costLineId: string; orderRef: string; shipmentId: string;
  paymentDate: string; amount: number; currency: Currency; paymentMethod: string; reference: string | null;
  note: string | null; recordedBy: string | null; recordedAt: string | null;
  status: "active" | "reversed"; reversalReason: string | null;
}
export function buildVendorPaymentRows(params: { payments: VendorPaymentTransaction[]; includeReversed: boolean }): VendorPaymentRow[] {
  const rows: VendorPaymentRow[] = [];
  for (const p of params.payments) {
    if (!params.includeReversed && !isActiveVendorPayment(p)) continue;
    rows.push({
      paymentId: p.id, vendor: vendorDisplayName(p), vendorKey: vendorKeyOf(p), costLineId: p.costItemId,
      orderRef: p.shipmentNumber || p.shipmentId, shipmentId: p.shipmentId,
      paymentDate: (p.paymentDate || p.createdAt || "").slice(0, 10), amount: round2(p.amount), currency: p.currency,
      paymentMethod: p.paymentMethod || "", reference: p.reference || null, note: p.internalNotes || null,
      recordedBy: p.createdBy || null, recordedAt: p.createdAt || null,
      status: p.status, reversalReason: p.status === "reversed" ? (p.reversalReason || null) : null,
    });
  }
  return rows;
}
export function summarizeVendorPaymentRows(rows: Array<{ currency: Currency; amount: number; status: "active" | "reversed" }>): ReceiptCurrencyTotals[] {
  return summarizeReceipts(rows);
}

// ── Operational Cash Movement report ────────────────────────────────────────
export interface CashMovementCurrencyTotals { currency: Currency; customerReceipts: number; vendorPayments: number; netCashMovement: number }
/**
 * Per-currency cash movement: active customer receipts (full payment amounts,
 * money in the door) minus active vendor payments (money out). Reversed and
 * cancelled records are excluded. This is NOT Official Profit.
 */
export function buildCashMovement(params: { customerPayments: CustomerPayment[]; vendorPayments: VendorPaymentTransaction[] }): CashMovementCurrencyTotals[] {
  const cur = new CurrencyMap<CashMovementCurrencyTotals>(() => ({ currency: "USD", customerReceipts: 0, vendorPayments: 0, netCashMovement: 0 }));
  for (const p of params.customerPayments) {
    if (!isActiveCustomerPayment(p)) continue;
    const t = cur.get(p.currency); t.currency = p.currency; t.customerReceipts = round2(t.customerReceipts + round2(p.amount));
  }
  for (const p of params.vendorPayments) {
    if (!isActiveVendorPayment(p)) continue;
    const t = cur.get(p.currency); t.currency = p.currency; t.vendorPayments = round2(t.vendorPayments + round2(p.amount));
  }
  for (const [, t] of cur.entries()) t.netCashMovement = round2(t.customerReceipts - t.vendorPayments);
  return cur.currencies().map((c) => cur.get(c));
}

// ── Financial Closing report ────────────────────────────────────────────────
export interface FinancialClosingRow {
  orderRef: string; shipmentId: string; customer: string;
  financialStatus: FinancialStatus; costStatementStatus: string;
  vendorRemainingByCurrency: Record<string, number>; customerRemainingByCurrency: Record<string, number>;
  draftInvoiceCount: number; closedAt: string | null; closedBy: string | null; closeReason: string | null;
  reopenedAt: string | null; reopenedBy: string | null; reopenCycleCount: number;
  activeReopenStatus: string | null;
}
export function buildFinancialClosingRows(params: {
  statements: CostStatement[];
  invoicesByShipment: (shipmentId: string) => CustomerInvoice[];
  vendorPaymentsByShipment: (shipmentId: string) => VendorPaymentTransaction[];
  customerPayments: CustomerPayment[];
}): FinancialClosingRow[] {
  return params.statements.map((stmt) => {
    const summary = buildOrderFinancialSummary({
      statement: stmt, invoices: params.invoicesByShipment(stmt.shipmentId),
      customerPayments: params.customerPayments, vendorPayments: params.vendorPaymentsByShipment(stmt.shipmentId), asOfDate: "",
    });
    const vendorRemainingByCurrency: Record<string, number> = {};
    const customerRemainingByCurrency: Record<string, number> = {};
    for (const [c, f] of Object.entries(summary.currencies)) {
      if (f.vendorRemaining) vendorRemainingByCurrency[c] = f.vendorRemaining;
      if (f.customerRemaining) customerRemainingByCurrency[c] = f.customerRemaining;
    }
    const cycles = Array.isArray(stmt.financialReopenCycles) ? (stmt.financialReopenCycles as Array<{ status?: string }>) : [];
    const active = cycles.find((c) => c?.status === "pending");
    return {
      orderRef: summary.orderRef, shipmentId: stmt.shipmentId, customer: stmt.companyName || "",
      financialStatus: summary.financialStatus, costStatementStatus: summary.costStatementStatus,
      vendorRemainingByCurrency, customerRemainingByCurrency, draftInvoiceCount: summary.counts.draftInvoices,
      closedAt: stmt.financialClosedAt || null, closedBy: stmt.financialClosedBy || null, closeReason: stmt.financialCloseReason || null,
      reopenedAt: stmt.financialReopenedAt || null, reopenedBy: stmt.financialReopenedBy || null,
      reopenCycleCount: cycles.length, activeReopenStatus: active ? "pending" : null,
    };
  });
}

// ── Pagination + sorting (safe, whitelisted) ────────────────────────────────
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export function normalizePaging(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const rawSize = Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: p, pageSize: size };
}

export interface Paged<T> { page: number; pageSize: number; totalItems: number; totalPages: number; rows: T[] }
export function paginate<T>(rows: T[], page: number, pageSize: number): Paged<T> {
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const p = Math.min(page, totalPages);
  const start = (p - 1) * pageSize;
  return { page: p, pageSize, totalItems, totalPages, rows: rows.slice(start, start + pageSize) };
}

export type SortDirection = "asc" | "desc";
/**
 * Sort by a WHITELISTED field only. An unknown field returns null so the
 * caller can reject it with a controlled 400 (never build a query from
 * arbitrary user input).
 */
export function applySort<T>(rows: T[], sortBy: string | undefined, direction: SortDirection, allowed: readonly string[]): T[] | null {
  if (!sortBy) return rows.slice();
  if (!allowed.includes(sortBy)) return null;
  const dir = direction === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = (a as any)[sortBy]; const bv = (b as any)[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

// ── Filter validation ───────────────────────────────────────────────────────
export type FilterValidation = { ok: true; from: string; to: string } | { ok: false; code: string; error: string };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** True when `s` is a real YYYY-MM-DD calendar date (rejects 2026-13-40). */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** Validate an optional [from,to] date range; reject malformed or inverted ranges (400). */
export function validateDateRange(from: unknown, to: unknown): FilterValidation {
  const f = typeof from === "string" && from ? from : "";
  const t = typeof to === "string" && to ? to : "";
  if (f && !isRealDate(f)) return { ok: false, code: "invalid_date_from", error: "dateFrom must be YYYY-MM-DD." };
  if (t && !isRealDate(t)) return { ok: false, code: "invalid_date_to", error: "dateTo must be YYYY-MM-DD." };
  if (f && t && f > t) return { ok: false, code: "inverted_date_range", error: "dateFrom must not be after dateTo." };
  return { ok: true, from: f, to: t };
}

// ── CSV serialization (one currency per row, safe escaping) ──────────────────
export interface CsvColumn<T> { header: string; value: (row: T) => string | number | null | undefined }
function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralize spreadsheet formula injection while keeping the value readable.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
/** Serialize rows to a UTF-8 CSV string. Numeric columns stay raw; currency is its own column. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")).join("\n");
  return body ? `${head}\n${body}\n` : `${head}\n`;
}
