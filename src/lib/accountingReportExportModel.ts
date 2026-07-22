/**
 * accountingReportExportModel.ts — Accounting Phase 8. The ONE shared,
 * read-only export model that sits between the Phase 7 report calculators
 * (accountingReports.ts) and the two renderers (PDF via accountingPdfRender,
 * CSV via toCsv). Both renderers consume the SAME model, so a PDF and a CSV of
 * the same report + filters are guaranteed to agree.
 *
 *   Phase 7 report result  →  AccountingReportExportModel  →  PDF | CSV
 *
 * No figure is recomputed here — the adapters only reshape already-computed
 * Phase 7 rows/totals into a stable export model. Currencies are never
 * combined; amounts are carried RAW (numbers, or null for "unavailable") so
 * CSV stays numeric and PDF can format, and unavailable values are shown as
 * text, never as zero. Driver Agreed Amount never appears.
 */
import type { Language, CompanyProfile } from "../types";
import type { AccountingPdfModel, PdfColumn, PdfMetaRow } from "./accountingPdfModel";
import {
  toCsv, type CsvColumn, round2,
  type ReceivableRow, type ReceivableCurrencyTotals, type PayableRow, type PayableCurrencyTotals,
  type ProfitRow, type ProfitCurrencyTotals, type CustomerReceiptRow, type VendorPaymentRow,
  type ReceiptCurrencyTotals, type CashMovementCurrencyTotals, type FinancialClosingRow,
  type OrderFinancialSummary,
} from "./accountingReports";

/** Hard cap on rows in a single export (safety — see the 413 in the routes). */
export const MAX_EXPORT_ROWS = 5000;

export type ExportColumnType = "text" | "date" | "amount" | "status";
export interface ExportColumn { key: string; label: string; type: ExportColumnType }
export interface ExportMetric { label: string; value: number | null; status?: string }
export interface ExportCurrencySummary { currency: string; metrics: ExportMetric[] }
export interface ExportEntity { type: "order" | "customer" | "vendor"; id?: string; name?: string; orderRef?: string }

export interface AccountingReportExportModel {
  exportId: string;
  reportType: string;
  title: string;
  generatedAt: string;
  generatedBy: { userId: string; name: string };
  period?: { dateFrom?: string; dateTo?: string; asOfDate?: string };
  filters: Array<{ label: string; value: string }>;
  entity?: ExportEntity;
  currencySummaries: ExportCurrencySummary[];
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
  disclaimer?: string;
}

// ── IDs + filenames ─────────────────────────────────────────────────────────
/**
 * A stable report-generation reference (NOT a financial transaction number).
 * Format RPTEXP-YYYYMMDD-XXXXXX. It is a report reference only and is never an
 * invoice / order / payment / cost-statement number.
 */
export function makeExportId(seed: string = "", now: number = Date.now()): string {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  let h = 0;
  const basis = `${seed}|${now}`;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  const suffix = h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  return `RPTEXP-${d}-${suffix}`;
}

/** Build a safe, professional filename; strips path separators + unsafe chars. */
export function sanitizeExportFilename(base: string, ext: "pdf" | "csv"): string {
  const cleaned = String(base || "report")
    .replace(/[^A-Za-z0-9]+/g, "_")   // every non-alphanumeric -> underscore (no path traversal, spaces, hyphens, control chars)
    .replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 120) || "report";
  return `${cleaned}.${ext}`;
}

// ── Formatting ──────────────────────────────────────────────────────────────
/** Amount for PDF: thousands + 2 decimals; null → "—" (never a fake zero). */
export function formatAmount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return round2(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const humanize = (s: string): string => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── Renderers ───────────────────────────────────────────────────────────────
/** CSV: one currency per row (currency is its own column); amounts stay RAW. */
export function reportExportModelToCsv(model: AccountingReportExportModel): string {
  const cols: CsvColumn<Record<string, unknown>>[] = model.columns.map((c) => ({
    header: c.label,
    value: (r) => {
      const v = r[c.key];
      if (c.type === "amount") return v == null || !Number.isFinite(Number(v)) ? "" : round2(Number(v));
      return v == null ? "" : String(v);
    },
  }));
  return toCsv(cols, model.rows);
}

const DIRECTION = (lang: Language): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");

function companyForExport(profile: CompanyProfile | null | undefined): AccountingPdfModel["company"] {
  const p = (profile || {}) as any;
  return {
    name: p.companyName || p.companyNameEn || "MARAS Group",
    address: p.address, phone: p.phone, email: p.email, website: p.website,
    registration: p.registrationDetails, tax: p.taxDetails, logoUrl: p.logoUrl, footerText: p.footerText,
  };
}

/**
 * Map the shared export model onto the existing AccountingPdfModel so the
 * shared renderAccountingPdf() draws it. Reports never show a signature,
 * stamp or bank block. Per-currency summaries render as a meta grid; the main
 * report table uses the model columns/rows; warnings + disclaimer go to the
 * notes + footer.
 */
export function reportExportModelToPdfModel(
  model: AccountingReportExportModel, company: CompanyProfile | null | undefined, language: Language,
): AccountingPdfModel {
  const parties: PdfMetaRow[] = [];
  if (model.entity) {
    const who = model.entity.type === "order" ? "Order" : model.entity.type === "customer" ? "Customer" : "Vendor";
    parties.push({ label: who, value: model.entity.name || model.entity.orderRef || model.entity.id || "—" });
    if (model.entity.orderRef && model.entity.type === "order") parties.push({ label: "Order Number", value: model.entity.orderRef });
  }
  const meta: PdfMetaRow[] = [
    { label: "Generated", value: new Date(model.generatedAt).toLocaleString("en-GB") },
    { label: "Generated By", value: model.generatedBy.name || model.generatedBy.userId },
    { label: "Export Ref", value: model.exportId },
  ];
  if (model.period?.dateFrom || model.period?.dateTo) meta.push({ label: "Period", value: `${model.period?.dateFrom || "…"} → ${model.period?.dateTo || "…"}` });
  if (model.period?.asOfDate) meta.push({ label: "As of", value: model.period.asOfDate });
  for (const f of model.filters) meta.push({ label: f.label, value: f.value });
  // Per-currency summaries as clearly-labelled meta rows (never mixed).
  for (const cs of model.currencySummaries) {
    for (const m of cs.metrics) {
      meta.push({ label: `${cs.currency} · ${m.label}`, value: m.value == null ? (m.status ? humanize(m.status) : "Unavailable") : `${formatAmount(m.value)} ${cs.currency}` });
    }
  }

  const columns: PdfColumn[] = model.columns.map((c) => ({ key: c.key, label: c.label, align: c.type === "amount" ? "right" : "left" }));
  const rows: Record<string, string>[] = model.rows.map((r) => {
    const out: Record<string, string> = {};
    for (const c of model.columns) {
      const v = r[c.key];
      out[c.key] = c.type === "amount"
        ? formatAmount(v == null ? null : Number(v))
        : c.type === "status" ? humanize(String(v ?? ""))
        : (v == null || v === "" ? "—" : String(v));
    }
    return out;
  });

  const noteParts: string[] = [];
  if (model.warnings.length) noteParts.push("Data Warnings: " + model.warnings.join("  •  "));
  const emptyNote = model.rows.length === 0 ? "No records found for the selected filters." : "";

  return {
    docType: "report",
    title: model.title,
    language,
    direction: DIRECTION(language),
    company: companyForExport(company),
    parties,
    meta,
    columns: model.rows.length ? columns : undefined,
    rows: model.rows.length ? rows : undefined,
    notes: [emptyNote, ...noteParts].filter(Boolean).join("\n") || undefined,
    flags: { showBank: false, showSignature: false, showStamp: false, showPageNumbers: true },
    footerText: model.disclaimer || "Generated from eTIR by MARAS. This is a read-only operational accounting report.",
  };
}

// ── Per-report adapters (Phase 7 result → export model) ──────────────────────
export interface ExportContext {
  generatedBy: { userId: string; name: string };
  generatedAt: string;
  exportId: string;
  filters: Array<{ label: string; value: string }>;
  period?: { dateFrom?: string; dateTo?: string; asOfDate?: string };
}
const REPORT_DISCLAIMER = "Generated from eTIR by MARAS. This is a read-only operational accounting report.";
const STATEMENT_DISCLAIMER = "This statement reflects records stored in eTIR by MARAS as of the generated date.";
const CASH_DISCLAIMER = "This is an operational cash movement report and is not the Official Profit calculation.";

export function receivablesExportModel(rows: ReceivableRow[], totals: ReceivableCurrencyTotals[], ctx: ExportContext, entity?: ExportEntity): AccountingReportExportModel {
  return {
    ...base("receivables", entity?.type === "customer" ? "Customer Account Statement" : "Accounts Receivable", ctx, REPORT_DISCLAIMER),
    entity,
    columns: [
      { key: "customer", label: "Customer", type: "text" }, { key: "invoiceNumber", label: "Invoice", type: "text" },
      { key: "orderRef", label: "Order Number", type: "text" }, { key: "issueDate", label: "Issue Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" }, { key: "invoiceAmount", label: "Invoiced", type: "amount" },
      { key: "receivedAmount", label: "Received", type: "amount" }, { key: "remainingAmount", label: "Remaining", type: "amount" },
      { key: "currency", label: "Currency", type: "text" }, { key: "agingBucket", label: "Aging", type: "status" },
      { key: "invoiceStatus", label: "Status", type: "status" }, { key: "financialStatus", label: "Financial", type: "status" },
    ],
    rows: rows.map((r) => ({ ...r, dueDate: r.dueDate || "Due date unavailable" })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Total Invoiced", value: t.invoiced }, { label: "Total Received", value: t.received },
      { label: "Outstanding", value: t.outstanding }, { label: "Overdue", value: t.overdue },
      { label: "Not Yet Due", value: t.notYetDue }, { label: "Invoice Count", value: t.invoiceCount },
      { label: "Overdue Invoice Count", value: t.overdueInvoiceCount },
    ] })),
    disclaimer: entity?.type === "customer" ? STATEMENT_DISCLAIMER : REPORT_DISCLAIMER,
  };
}

export function payablesExportModel(rows: PayableRow[], totals: PayableCurrencyTotals[], ctx: ExportContext, entity?: ExportEntity): AccountingReportExportModel {
  return {
    ...base("payables", entity?.type === "vendor" ? "Vendor Account Statement" : "Accounts Payable", ctx, REPORT_DISCLAIMER),
    entity,
    columns: [
      { key: "vendor", label: "Vendor", type: "text" }, { key: "orderRef", label: "Order Number", type: "text" },
      { key: "description", label: "Description", type: "text" }, { key: "approvedDate", label: "Approved Date", type: "date" },
      { key: "approvedAmount", label: "Approved", type: "amount" }, { key: "paidAmount", label: "Paid", type: "amount" },
      { key: "remainingAmount", label: "Remaining", type: "amount" }, { key: "currency", label: "Currency", type: "text" },
      { key: "paymentStatus", label: "Status", type: "status" }, { key: "financialStatus", label: "Financial", type: "status" },
    ],
    rows: rows.map((r) => ({ ...r })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Approved Costs", value: t.approved }, { label: "Vendor Payments", value: t.paid },
      { label: "Remaining Payable", value: t.remaining }, { label: "Unpaid Amount", value: t.unpaidAmount },
      { label: "Partially Paid Amount", value: t.partiallyPaidAmount }, { label: "Paid Lines", value: t.paidLineCount },
      { label: "Unpaid Lines", value: t.unpaidLineCount }, { label: "Partially Paid Lines", value: t.partiallyPaidLineCount },
    ] })),
    disclaimer: entity?.type === "vendor" ? STATEMENT_DISCLAIMER : REPORT_DISCLAIMER,
  };
}

export function profitExportModel(rows: ProfitRow[], totals: ProfitCurrencyTotals[], ctx: ExportContext): AccountingReportExportModel {
  const pendingCount = rows.filter((r) => r.profitStatus !== "available" && r.profitStatus !== "currency_mismatch").length;
  const mismatchCount = rows.filter((r) => r.profitStatus === "currency_mismatch").length;
  return {
    ...base("profit", "Official Profit Report", ctx, "Official Profit is issued customer invoices minus approved vendor costs. Payment timing does not change it. " + REPORT_DISCLAIMER),
    columns: [
      { key: "orderRef", label: "Order Number", type: "text" }, { key: "customer", label: "Customer", type: "text" },
      { key: "transportMode", label: "Transport", type: "text" }, { key: "currency", label: "Currency", type: "text" },
      { key: "issuedInvoiceTotal", label: "Invoiced", type: "amount" }, { key: "approvedVendorCost", label: "Approved Cost", type: "amount" },
      { key: "officialProfit", label: "Official Profit", type: "amount" }, { key: "profitStatus", label: "Profit Status", type: "status" },
      { key: "costStatementStatus", label: "Cost Status", type: "status" }, { key: "financialStatus", label: "Financial", type: "status" },
      { key: "latestInvoiceDate", label: "Latest Invoice", type: "date" }, { key: "financialCloseDate", label: "Closed", type: "date" },
    ],
    rows: rows.map((r) => ({ ...r })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Issued Invoice Total", value: t.issuedInvoiceTotal }, { label: "Approved Vendor Costs", value: t.approvedVendorCost },
      { label: "Official Profit", value: t.officialProfit }, { label: "Orders (available profit)", value: t.orderCount },
      { label: "Orders pending profit", value: pendingCount }, { label: "Orders currency mismatch", value: mismatchCount },
    ] })),
  };
}

export function cashMovementExportModel(totals: CashMovementCurrencyTotals[], ctx: ExportContext): AccountingReportExportModel {
  return {
    ...base("cash-movement", "Operational Cash Movement", ctx, CASH_DISCLAIMER),
    columns: [
      { key: "currency", label: "Currency", type: "text" }, { key: "customerReceipts", label: "Customer Receipts", type: "amount" },
      { key: "vendorPayments", label: "Vendor Payments", type: "amount" }, { key: "netCashMovement", label: "Net Cash Movement", type: "amount" },
    ],
    rows: totals.map((t) => ({ currency: t.currency, customerReceipts: t.customerReceipts, vendorPayments: t.vendorPayments, netCashMovement: t.netCashMovement })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Customer Receipts", value: t.customerReceipts }, { label: "Vendor Payments", value: t.vendorPayments }, { label: "Net Cash Movement", value: t.netCashMovement },
    ] })),
    warnings: [],
  };
}

export function customerReceiptsExportModel(rows: CustomerReceiptRow[], totals: ReceiptCurrencyTotals[], ctx: ExportContext): AccountingReportExportModel {
  return {
    ...base("customer-receipts", "Customer Receipts", ctx, CASH_DISCLAIMER),
    columns: [
      { key: "paymentDate", label: "Date", type: "date" }, { key: "customer", label: "Customer", type: "text" },
      { key: "orderRefs", label: "Order Numbers", type: "text" }, { key: "invoiceNumbers", label: "Invoices", type: "text" },
      { key: "paymentMethod", label: "Method", type: "text" }, { key: "reference", label: "Reference", type: "text" },
      { key: "amount", label: "Amount", type: "amount" }, { key: "currency", label: "Currency", type: "text" }, { key: "status", label: "Status", type: "status" },
    ],
    rows: rows.map((r) => ({ ...r, orderRefs: r.orderRefs.join("; "), invoiceNumbers: r.invoiceNumbers.join("; ") })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Active Receipts", value: t.active }, { label: "Reversed", value: t.reversed }, { label: "Count", value: t.count },
    ] })),
  };
}

export function vendorPaymentsExportModel(rows: VendorPaymentRow[], totals: ReceiptCurrencyTotals[], ctx: ExportContext): AccountingReportExportModel {
  return {
    ...base("vendor-payments", "Vendor Payments", ctx, CASH_DISCLAIMER),
    columns: [
      { key: "paymentDate", label: "Date", type: "date" }, { key: "vendor", label: "Vendor", type: "text" },
      { key: "orderRef", label: "Order Number", type: "text" }, { key: "costLineId", label: "Cost Line", type: "text" },
      { key: "paymentMethod", label: "Method", type: "text" }, { key: "reference", label: "Reference", type: "text" },
      { key: "amount", label: "Amount", type: "amount" }, { key: "currency", label: "Currency", type: "text" }, { key: "status", label: "Status", type: "status" },
    ],
    rows: rows.map((r) => ({ ...r })),
    currencySummaries: totals.map((t) => ({ currency: t.currency, metrics: [
      { label: "Active Payments", value: t.active }, { label: "Reversed/Cancelled", value: t.reversed }, { label: "Count", value: t.count },
    ] })),
  };
}

export function financialClosingExportModel(rows: FinancialClosingRow[], ctx: ExportContext): AccountingReportExportModel {
  const flat = rows.map((r) => ({
    orderRef: r.orderRef, customer: r.customer, financialStatus: r.financialStatus, costStatementStatus: r.costStatementStatus,
    draftInvoiceCount: r.draftInvoiceCount, customerRemaining: summarizeBalances(r.customerRemainingByCurrency),
    vendorRemaining: summarizeBalances(r.vendorRemainingByCurrency), closedAt: r.closedAt ? r.closedAt.slice(0, 10) : "",
    closedBy: r.closedBy || "", closeReason: r.closeReason || "", reopenedAt: r.reopenedAt ? r.reopenedAt.slice(0, 10) : "",
    reopenCycleCount: r.reopenCycleCount, activeReopenStatus: r.activeReopenStatus || "",
  }));
  return {
    ...base("financial-closing", "Financial Closing Report", ctx, REPORT_DISCLAIMER),
    columns: [
      { key: "orderRef", label: "Order Number", type: "text" }, { key: "customer", label: "Customer", type: "text" },
      { key: "financialStatus", label: "Financial Status", type: "status" }, { key: "costStatementStatus", label: "Cost Status", type: "status" },
      { key: "customerRemaining", label: "Customer Remaining", type: "text" }, { key: "vendorRemaining", label: "Vendor Remaining", type: "text" },
      { key: "draftInvoiceCount", label: "Drafts", type: "text" }, { key: "closedAt", label: "Closed", type: "date" },
      { key: "closedBy", label: "Closed By", type: "text" }, { key: "reopenedAt", label: "Reopened", type: "date" }, { key: "reopenCycleCount", label: "Reopens", type: "text" },
    ],
    rows: flat,
    currencySummaries: [{ currency: "—", metrics: [
      { label: "Total Orders", value: rows.length }, { label: "Financially Closed", value: rows.filter((r) => r.financialStatus === "financial_closed").length },
      { label: "Financially Open", value: rows.filter((r) => r.financialStatus === "financial_open").length },
      { label: "Financially Reopened", value: rows.filter((r) => r.financialStatus === "financial_reopened").length },
    ] }],
  };
}
const summarizeBalances = (m: Record<string, number>): string =>
  Object.entries(m).map(([c, v]) => `${formatAmount(v)} ${c}`).join("; ") || "—";

export function orderSummaryExportModel(summary: OrderFinancialSummary, ctx: ExportContext): AccountingReportExportModel {
  const rows = Object.entries(summary.currencies).map(([currency, f]) => ({
    currency, customerInvoiced: f.customerInvoiced, customerReceived: f.customerReceived, customerRemaining: f.customerRemaining,
    vendorApproved: f.vendorApproved, vendorPaid: f.vendorPaid, vendorRemaining: f.vendorRemaining,
    officialProfit: f.officialProfit, profitStatus: f.profitStatus, netCashMovement: f.netCashMovement,
  }));
  const warnings = summary.warnings.map((w) => `${w.code}: ${w.message}${w.ref ? ` (${w.ref})` : ""}`);
  return {
    ...base("order-financial-summary", `Order Financial Summary — ${summary.orderRef}`, ctx, "Official Profit is issued customer invoices minus approved vendor costs. Payment timing does not change Official Profit. " + REPORT_DISCLAIMER),
    entity: { type: "order", id: summary.shipmentId, name: summary.customer.name, orderRef: summary.orderRef },
    columns: [
      { key: "currency", label: "Currency", type: "text" },
      { key: "customerInvoiced", label: "Cust. Invoiced", type: "amount" }, { key: "customerReceived", label: "Cust. Received", type: "amount" }, { key: "customerRemaining", label: "Cust. Remaining", type: "amount" },
      { key: "vendorApproved", label: "Vend. Approved", type: "amount" }, { key: "vendorPaid", label: "Vend. Paid", type: "amount" }, { key: "vendorRemaining", label: "Vend. Remaining", type: "amount" },
      { key: "officialProfit", label: "Official Profit", type: "amount" }, { key: "profitStatus", label: "Profit Status", type: "status" }, { key: "netCashMovement", label: "Cash Movement", type: "amount" },
    ],
    rows,
    currencySummaries: Object.entries(summary.currencies).map(([currency, f]) => ({ currency, metrics: [
      { label: "Official Profit", value: f.officialProfit, status: f.profitStatus }, { label: "Net Cash Movement", value: f.netCashMovement },
    ] })),
    filters: [
      ...ctx.filters,
      { label: "Cost Statement Status", value: humanize(summary.costStatementStatus) },
      { label: "Financial Status", value: humanize(summary.financialStatus) },
    ],
    warnings,
  };
}

function base(reportType: string, title: string, ctx: ExportContext, disclaimer: string): AccountingReportExportModel {
  return {
    exportId: ctx.exportId, reportType, title, generatedAt: ctx.generatedAt, generatedBy: ctx.generatedBy,
    period: ctx.period, filters: ctx.filters, currencySummaries: [], columns: [], rows: [], warnings: [], disclaimer,
  };
}
