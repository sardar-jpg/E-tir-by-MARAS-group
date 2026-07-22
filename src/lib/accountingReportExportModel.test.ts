import { describe, it, expect } from "vitest";
import type { CompanyProfile } from "../types";
import {
  makeExportId, sanitizeExportFilename, formatAmount, MAX_EXPORT_ROWS,
  reportExportModelToCsv, reportExportModelToPdfModel,
  receivablesExportModel, payablesExportModel, profitExportModel, cashMovementExportModel,
  customerReceiptsExportModel, vendorPaymentsExportModel, financialClosingExportModel, orderSummaryExportModel,
  type ExportContext,
} from "./accountingReportExportModel";
import { renderAccountingPdf } from "./accountingPdfRender";
import type {
  ReceivableRow, PayableRow, ProfitRow, OrderFinancialSummary, CustomerReceiptRow, CashMovementCurrencyTotals,
} from "./accountingReports";

const CTX: ExportContext = { generatedBy: { userId: "u1", name: "Sara" }, generatedAt: "2026-07-22T10:00:00Z", exportId: "RPTEXP-20260722-ABC123", filters: [] };
const company: CompanyProfile = { companyName: "MARAS Group", address: "Erbil", email: "a@b.co" } as CompanyProfile;
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";

// ── Export ID + filename ──────────────────────────────────────────────────────
describe("export id + filenames", () => {
  it("makeExportId is a report reference, not a financial number", () => {
    const id = makeExportId("seed", Date.UTC(2026, 6, 22));
    expect(id).toMatch(/^RPTEXP-\d{8}-[A-Z0-9]{6}$/);
    expect(id).not.toMatch(/invoice|order|payment/i);
  });
  it("sanitizeExportFilename strips path traversal + unsafe chars and keeps extension", () => {
    expect(sanitizeExportFilename("../../etc/passwd", "pdf")).toBe("etc_passwd.pdf");
    expect(sanitizeExportFilename("MARAS Accounts Receivable 2026-07-22", "csv")).toBe("MARAS_Accounts_Receivable_2026_07_22.csv");
    expect(sanitizeExportFilename("شركة", "pdf")).toBe("report.pdf"); // non-latin falls back safely
  });
  it("formatAmount shows unavailable as em dash, never zero", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(1000)).toBe("1,000.00");
    expect(formatAmount(0)).toBe("0.00");
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const recRow = (o: Partial<ReceivableRow>): ReceivableRow => ({
  invoiceId: "i", invoiceNumber: "INV1", orderRef: "MAR-2026-001", shipmentId: "S1", customer: "Acme",
  issueDate: "2026-01-10", dueDate: "2026-02-10", currency: "USD", invoiceAmount: 1000, receivedAmount: 400,
  remainingAmount: 600, invoiceStatus: "partially_paid", daysOverdue: 0, agingBucket: "current_not_due",
  financialStatus: "financial_open", lastPaymentDate: "2026-01-15", ...o,
});
const payRow = (o: Partial<PayableRow>): PayableRow => ({
  costLineId: "c1", description: "Freight", orderRef: "MAR-2026-001", shipmentId: "S1", vendorKey: "name:vendor a",
  vendor: "Vendor A", currency: "USD", approvedAmount: 600, paidAmount: 250, remainingAmount: 350,
  paymentStatus: "partially_paid", paymentCount: 1, approvedDate: "2026-01-20", dueDate: null, financialStatus: "financial_open", ...o,
});

// ── CSV / PDF parity ──────────────────────────────────────────────────────────
describe("CSV and PDF derive from the SAME export model", () => {
  const model = receivablesExportModel([recRow({}), recRow({ currency: "IQD", invoiceAmount: 5000, remainingAmount: 5000, receivedAmount: 0 })], [
    { currency: "USD", invoiced: 1000, received: 400, outstanding: 600, overdue: 0, notYetDue: 600, invoiceCount: 1, overdueInvoiceCount: 0, aging: {} as any },
    { currency: "IQD", invoiced: 5000, received: 0, outstanding: 5000, overdue: 0, notYetDue: 5000, invoiceCount: 1, overdueInvoiceCount: 0, aging: {} as any },
  ], CTX);
  it("CSV keeps amounts raw + currency as its own column (formula-safe)", () => {
    const csv = reportExportModelToCsv(model);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Currency");
    expect(lines[0]).toContain("Invoiced");
    expect(lines[1]).toContain("1000"); // raw, not "1,000.00"
    expect(lines[1]).toContain("USD");
    expect(csv).not.toContain("1,000.00");
  });
  it("PDF model reuses the same per-currency summaries (no recomputation, never mixed)", () => {
    const pdf = reportExportModelToPdfModel(model, company, "en");
    expect(pdf.docType).toBe("report");
    expect(pdf.flags).toMatchObject({ showSignature: false, showStamp: false, showBank: false, showPageNumbers: true });
    const metaJoined = pdf.meta.map((m) => `${m.label}=${m.value}`).join("|");
    expect(metaJoined).toContain("USD · Outstanding=600.00 USD");
    expect(metaJoined).toContain("IQD · Outstanding=5,000.00 IQD");
    expect(pdf.meta.some((m) => m.label === "Export Ref" && m.value === CTX.exportId)).toBe(true);
  });
  it("renders real PDF bytes", async () => {
    const buf = await renderAccountingPdf(reportExportModelToPdfModel(model, company, "en"));
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(800);
  });
});

// ── Profit: unavailable is text, not zero; no Driver Agreed Amount ────────────
describe("profit export", () => {
  const rows: ProfitRow[] = [
    { orderRef: "MAR-2026-001", shipmentId: "S1", customer: "Acme", transportMode: "land", currency: "USD", issuedInvoiceTotal: 1000, approvedVendorCost: 600, officialProfit: 400, profitStatus: "available", costStatementStatus: "final_closed", financialStatus: "financial_open", latestInvoiceDate: "2026-01-10", financialCloseDate: null },
    { orderRef: "MAR-2026-002", shipmentId: "S2", customer: "Beta", transportMode: "sea", currency: "USD", issuedInvoiceTotal: 0, approvedVendorCost: 0, officialProfit: null, profitStatus: "pending_cost_approval", costStatementStatus: "draft", financialStatus: "financial_open", latestInvoiceDate: null, financialCloseDate: null },
  ];
  const model = profitExportModel(rows, [{ currency: "USD", issuedInvoiceTotal: 1000, approvedVendorCost: 600, officialProfit: 400, orderCount: 1 }], CTX);
  it("unavailable profit renders as text, not zero, in the PDF rows", () => {
    const pdf = reportExportModelToPdfModel(model, company, "en");
    const pendingRow = pdf.rows!.find((r) => r.orderRef === "MAR-2026-002")!;
    expect(pendingRow.officialProfit).toBe("—");
    expect(pendingRow.profitStatus).toBe("Pending Cost Approval");
  });
  it("CSV leaves unavailable profit blank (not 0)", () => {
    const csv = reportExportModelToCsv(model);
    const pendingLine = csv.split("\n").find((l) => l.startsWith("MAR-2026-002"))!;
    expect(pendingLine).toMatch(/,,/); // an empty officialProfit cell
  });
  it("no Driver Agreed Amount column exists anywhere", () => {
    expect(JSON.stringify(model)).not.toMatch(/agreed/i);
  });
});

// ── Cash movement disclaimer ─────────────────────────────────────────────────
describe("cash movement export", () => {
  const totals: CashMovementCurrencyTotals[] = [{ currency: "USD", customerReceipts: 1000, vendorPayments: 300, netCashMovement: 700 }];
  it("carries the not-profit disclaimer as the PDF footer", () => {
    const model = cashMovementExportModel(totals, CTX);
    expect(model.disclaimer).toContain("not the Official Profit");
    const pdf = reportExportModelToPdfModel(model, company, "en");
    expect(pdf.footerText).toContain("not the Official Profit");
  });
});

// ── Empty report renders (no fake rows) ──────────────────────────────────────
describe("empty report", () => {
  it("renders a valid PDF with a no-records note and no table", async () => {
    const model = receivablesExportModel([], [], CTX);
    const pdf = reportExportModelToPdfModel(model, company, "en");
    expect(pdf.rows).toBeUndefined();
    expect(pdf.notes).toContain("No records found");
    expect(isPdf(await renderAccountingPdf(pdf))).toBe(true);
  });
});

// ── Multi-page (renderer repeats header) ─────────────────────────────────────
describe("multi-page report", () => {
  it("renders many rows into a multi-page PDF without throwing", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => recRow({ invoiceNumber: `INV${i}`, customer: "Acme Global Logistics and Freight Forwarding Company Limited " + i }));
    const model = receivablesExportModel(rows, [{ currency: "USD", invoiced: 1000, received: 400, outstanding: 600, overdue: 0, notYetDue: 600, invoiceCount: 120, overdueInvoiceCount: 0, aging: {} as any }], CTX);
    const buf = await renderAccountingPdf(reportExportModelToPdfModel(model, company, "en"));
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(3000);
  });
});

// ── Arabic name renders without crash ────────────────────────────────────────
describe("arabic safety", () => {
  it("renders an Arabic customer name without throwing", async () => {
    const model = receivablesExportModel([recRow({ customer: "شركة المعمار للنقل" })], [{ currency: "USD", invoiced: 1000, received: 0, outstanding: 1000, overdue: 0, notYetDue: 1000, invoiceCount: 1, overdueInvoiceCount: 0, aging: {} as any }], CTX);
    const buf = await renderAccountingPdf(reportExportModelToPdfModel(model, company, "ar"));
    expect(isPdf(buf)).toBe(true);
  });
});

// ── Other adapters build coherent models ─────────────────────────────────────
describe("other adapters", () => {
  it("payables + vendor statement entity", () => {
    const m = payablesExportModel([payRow({})], [{ currency: "USD", approved: 600, paid: 250, remaining: 350, unpaidAmount: 0, partiallyPaidAmount: 350, paidLineCount: 0, unpaidLineCount: 0, partiallyPaidLineCount: 1 }], CTX, { type: "vendor", name: "Vendor A" });
    expect(m.entity?.type).toBe("vendor");
    expect(m.title).toBe("Vendor Account Statement");
  });
  it("order summary carries orderRef entity + warnings", () => {
    const summary: OrderFinancialSummary = {
      shipmentId: "S1", orderRef: "MAR-2026-001", customer: { id: null, name: "Acme" }, costStatementStatus: "final_closed", financialStatus: "financial_open",
      currencies: { USD: { customerInvoiced: 1000, customerReceived: 400, customerRemaining: 600, vendorApproved: 600, vendorPaid: 250, vendorRemaining: 350, officialProfit: 400, profitStatus: "available", netCashMovement: 150 } },
      counts: { activeInvoices: 1, draftInvoices: 0, cancelledInvoices: 0, vendorCostLines: 1, customerPayments: 1, vendorPayments: 1 },
      financialClosing: { status: "financial_open", closedAt: null, closedBy: null, closeReason: null, reopenedAt: null, reopenedBy: null, reopenCycleCount: 0 },
      warnings: [{ code: "vendor_overpaid", message: "over", ref: "Freight" }],
    };
    const m = orderSummaryExportModel(summary, CTX);
    expect(m.entity).toMatchObject({ type: "order", orderRef: "MAR-2026-001" });
    expect(m.warnings[0]).toContain("vendor_overpaid");
  });
  it("customer receipts + financial closing build without error", () => {
    const receipts: CustomerReceiptRow[] = [{ paymentId: "p", paymentDate: "2026-01-15", customer: "Acme", amount: 400, currency: "USD", paymentMethod: "bank", reference: null, recordedBy: "u", recordedAt: "t", status: "active", reversalReason: null, invoiceNumbers: ["INV1"], orderRefs: ["MAR-2026-001"] }];
    expect(customerReceiptsExportModel(receipts, [{ currency: "USD", active: 400, reversed: 0, count: 1 }], CTX).rows[0].orderRefs).toBe("MAR-2026-001");
    expect(financialClosingExportModel([], CTX).currencySummaries[0].metrics[0].label).toBe("Total Orders");
    expect(MAX_EXPORT_ROWS).toBe(5000);
  });
});
