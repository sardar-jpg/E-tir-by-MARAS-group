import { describe, it, expect } from "vitest";
import type { CostStatement, CustomerInvoice, CustomerPayment, VendorPaymentTransaction } from "../types";
import {
  calculateReceivableAging, buildOrderFinancialSummary, buildReceivableRows, summarizeReceivables,
  buildPayableRows, summarizePayables, buildProfitRows, summarizeProfit, buildCustomerReceiptRows,
  summarizeReceipts, buildVendorPaymentRows, buildCashMovement, buildFinancialClosingRows,
  paginate, applySort, normalizePaging, validateDateRange, toCsv, vendorKeyOf, MAX_PAGE_SIZE,
} from "./accountingReports";

// ── Fixtures ────────────────────────────────────────────────────────────────
function invoice(over: Partial<CustomerInvoice>): CustomerInvoice {
  return {
    id: over.id || "inv1", invoiceNumber: over.invoiceNumber || "MAR-2026-001-INV", shipmentId: over.shipmentId || "S1",
    shipmentNumber: over.shipmentNumber || "MAR-2026-001", companyName: over.companyName || "Acme",
    currency: over.currency || "USD", pricingMode: "manual", costBasis: 0, sellingAmount: over.sellingAmount ?? 1000,
    status: over.status || "issued", createdAt: over.createdAt || "2026-01-10T00:00:00Z", ...over,
  } as CustomerInvoice;
}
function custPayment(over: Partial<CustomerPayment>): CustomerPayment {
  return {
    id: over.id || "p1", companyName: over.companyName || "Acme", amount: over.amount ?? 400, currency: over.currency || "USD",
    paymentDate: over.paymentDate || "2026-01-15", paymentMethod: over.paymentMethod || "bank",
    allocations: over.allocations || [], status: over.status || "active", createdBy: over.createdBy || "u1",
    createdAt: over.createdAt || "2026-01-15T00:00:00Z", ...over,
  } as CustomerPayment;
}
function vendorPayment(over: Partial<VendorPaymentTransaction>): VendorPaymentTransaction {
  return {
    id: over.id || "vp1", shipmentId: over.shipmentId || "S1", shipmentNumber: over.shipmentNumber || "MAR-2026-001",
    costStatementId: over.shipmentId || "S1", costItemId: over.costItemId || "c1", vendorName: over.vendorName || "Vendor A",
    amount: over.amount ?? 300, currency: over.currency || "USD", paymentDate: over.paymentDate || "2026-01-20",
    paymentMethod: over.paymentMethod || "bank", createdBy: over.createdBy || "u1", createdAt: over.createdAt || "2026-01-20T00:00:00Z",
    status: over.status || "active", ...over,
  } as VendorPaymentTransaction;
}
function statement(over: Partial<CostStatement>): CostStatement {
  return {
    shipmentId: over.shipmentId || "S1", shipmentNumber: over.shipmentNumber || "MAR-2026-001", companyName: over.companyName || "Acme",
    shipmentType: over.shipmentType || "land", date: over.date || "2026-01-05", currency: over.currency || "USD",
    totalCost: over.totalCost ?? 600, paidAmount: 0, remainingBalance: 0, paymentStatus: "Unpaid",
    notes: "", items: over.items || [], createdAt: over.createdAt || "2026-01-05T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z",
    accountingStatus: over.accountingStatus ?? "final_closed", ...over,
  } as CostStatement;
}
const item = (over: Partial<CostStatement["items"][number]>) => ({
  id: (over as any).id || "c1", costType: "freight", description: (over as any).description || "Freight", quantity: 1, unitPrice: 0,
  totalAmount: (over as any).totalAmount ?? 600, currency: (over as any).currency || "USD", supplierName: (over as any).supplierName || "Vendor A",
  ...over,
}) as CostStatement["items"][number];

// ── 38.1 Official Profit ────────────────────────────────────────────────────
describe("Official Profit — issued invoice minus approved vendor cost", () => {
  const base = () => buildOrderFinancialSummary({
    statement: statement({ items: [item({ totalAmount: 600 })] }),
    invoices: [invoice({ sellingAmount: 1000, status: "issued" })],
    customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
  });
  it("profit = 1000 − 600 = 400 for the matching currency", () => {
    expect(base().currencies.USD.officialProfit).toBe(400);
    expect(base().currencies.USD.profitStatus).toBe("available");
  });
  it("draft invoice is excluded from profit (no active invoice)", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ items: [item({ totalAmount: 600 })] }),
      invoices: [invoice({ status: "draft", sellingAmount: 1000 })],
      customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    expect(s.currencies.USD.customerInvoiced).toBe(0);
    expect(s.currencies.USD.profitStatus).toBe("no_active_invoice");
    expect(s.currencies.USD.officialProfit).toBeNull();
  });
  it("cancelled invoice is excluded from profit", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ items: [item({ totalAmount: 600 })] }),
      invoices: [invoice({ status: "cancelled", sellingAmount: 1000 })],
      customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    expect(s.currencies.USD.customerInvoiced).toBe(0);
    expect(s.currencies.USD.officialProfit).toBeNull();
  });
  it("customer and vendor payment TIMING never change profit", () => {
    const noPay = base().currencies.USD.officialProfit;
    const withPay = buildOrderFinancialSummary({
      statement: statement({ items: [item({ totalAmount: 600 })] }),
      invoices: [invoice({ sellingAmount: 1000, status: "partially_paid" })],
      customerPayments: [custPayment({ amount: 250, allocations: [{ invoiceId: "inv1", invoiceNumber: "X", amount: 250 }] })],
      vendorPayments: [vendorPayment({ amount: 600, costItemId: "c1" })],
      asOfDate: "2026-02-01",
    }).currencies.USD.officialProfit;
    expect(withPay).toBe(noPay);
    expect(withPay).toBe(400);
  });
  it("unapproved cost statement → profit pending, cost not counted", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ accountingStatus: "draft", items: [item({ totalAmount: 600 })] }),
      invoices: [invoice({ sellingAmount: 1000, status: "issued" })],
      customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    expect(s.currencies.USD.vendorApproved).toBe(0);
    expect(s.currencies.USD.profitStatus).toBe("pending_cost_approval");
    expect(s.currencies.USD.officialProfit).toBeNull();
  });
  it("different invoice and cost currencies are never subtracted", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ items: [item({ totalAmount: 600, currency: "IQD" })] }),
      invoices: [invoice({ sellingAmount: 1000, currency: "USD", status: "issued" })],
      customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    // USD has invoice but no approved cost → cost 0, so profit = 1000 for USD;
    // IQD has cost but no invoice → no_active_invoice. Never a cross-subtraction.
    expect(s.currencies.USD.officialProfit).toBe(1000);
    expect(s.currencies.IQD.profitStatus).toBe("no_active_invoice");
    expect(s.currencies.IQD.officialProfit).toBeNull();
  });
});

// ── 38.2 Order Financial Summary ────────────────────────────────────────────
describe("Order Financial Summary", () => {
  it("computes customer + vendor figures, cash movement, and groups currencies independently", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ items: [item({ id: "c1", totalAmount: 600, currency: "USD" }), item({ id: "c2", totalAmount: 900000, currency: "IQD", supplierName: "V2" })] }),
      invoices: [
        invoice({ id: "invUsd", currency: "USD", sellingAmount: 1000, status: "partially_paid" }),
        invoice({ id: "invIqd", currency: "IQD", sellingAmount: 1500000, status: "issued", invoiceNumber: "MAR-IQD" }),
      ],
      customerPayments: [custPayment({ amount: 400, currency: "USD", allocations: [{ invoiceId: "invUsd", invoiceNumber: "X", amount: 400 }] })],
      vendorPayments: [vendorPayment({ costItemId: "c1", amount: 600, currency: "USD" })],
      asOfDate: "2026-02-01",
    });
    expect(s.currencies.USD).toMatchObject({ customerInvoiced: 1000, customerReceived: 400, customerRemaining: 600, vendorApproved: 600, vendorPaid: 600, vendorRemaining: 0, officialProfit: 400, netCashMovement: -200 });
    expect(s.currencies.IQD).toMatchObject({ customerInvoiced: 1500000, vendorApproved: 900000, officialProfit: 600000 });
    expect(s.counts.activeInvoices).toBe(2);
    expect(s.financialStatus).toBe("financial_open");
  });
  it("reflects financial status from the statement", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ financialStatus: "financial_closed", financialClosedAt: "2026-03-01T00:00:00Z", financialClosedBy: "u9", items: [item({})] }),
      invoices: [invoice({ status: "paid" })], customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    expect(s.financialStatus).toBe("financial_closed");
    expect(s.financialClosing.closedBy).toBe("u9");
  });
});

// ── 38.5 Receivables + aging ────────────────────────────────────────────────
describe("Receivables report + aging", () => {
  const fin = () => "financial_open" as const;
  const invoices = [
    invoice({ id: "a", invoiceNumber: "A", sellingAmount: 1000, status: "issued", dueDate: "2026-01-01" }), // overdue
    invoice({ id: "b", invoiceNumber: "B", sellingAmount: 500, status: "partially_paid", dueDate: "2026-01-25" }),
    invoice({ id: "c", invoiceNumber: "C", sellingAmount: 800, status: "paid", dueDate: "2026-01-01" }), // fully paid → not outstanding
    invoice({ id: "d", invoiceNumber: "D", sellingAmount: 700, status: "draft" }), // excluded
    invoice({ id: "e", invoiceNumber: "E", sellingAmount: 200, status: "cancelled" }), // excluded
    invoice({ id: "f", invoiceNumber: "F", sellingAmount: 300, status: "issued" }), // no due date
  ];
  const payments = [
    custPayment({ id: "pb", amount: 200, allocations: [{ invoiceId: "b", invoiceNumber: "B", amount: 200 }] }),
    custPayment({ id: "pc", amount: 800, allocations: [{ invoiceId: "c", invoiceNumber: "C", amount: 800 }] }),
  ];
  const rows = buildReceivableRows({ invoices, customerPayments: payments, financialStatusByShipment: fin, asOfDate: "2026-02-10" });
  it("includes issued/partially_paid/paid, excludes draft + cancelled", () => {
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual(["A", "B", "C", "F"]);
  });
  it("paid invoice has zero remaining and current bucket", () => {
    const c = rows.find((r) => r.invoiceNumber === "C")!;
    expect(c.remainingAmount).toBe(0);
    expect(c.agingBucket).toBe("current_not_due");
  });
  it("missing due date → due_date_unavailable", () => {
    expect(rows.find((r) => r.invoiceNumber === "F")!.agingBucket).toBe("due_date_unavailable");
  });
  it("aging buckets by days overdue", () => {
    expect(calculateReceivableAging({ dueDate: "2026-02-05", remainingAmount: 100, asOfDate: "2026-02-20" }).bucket).toBe("overdue_1_30");
    expect(calculateReceivableAging({ dueDate: "2026-01-05", remainingAmount: 100, asOfDate: "2026-02-20" }).bucket).toBe("overdue_31_60");
    expect(calculateReceivableAging({ dueDate: "2025-12-05", remainingAmount: 100, asOfDate: "2026-02-20" }).bucket).toBe("overdue_61_90");
    expect(calculateReceivableAging({ dueDate: "2025-09-05", remainingAmount: 100, asOfDate: "2026-02-20" }).bucket).toBe("overdue_over_90");
    expect(calculateReceivableAging({ dueDate: "2026-03-05", remainingAmount: 100, asOfDate: "2026-02-20" }).bucket).toBe("current_not_due");
    expect(calculateReceivableAging({ dueDate: "2026-01-01", remainingAmount: 0, asOfDate: "2026-02-20" }).bucket).toBe("current_not_due");
  });
  it("per-currency totals separate; outstanding excludes fully-paid", () => {
    const iqd = buildReceivableRows({ invoices: [invoice({ id: "z", currency: "IQD", sellingAmount: 5000, status: "issued" })], customerPayments: [], financialStatusByShipment: fin, asOfDate: "2026-02-10" });
    const totals = summarizeReceivables([...rows, ...iqd]);
    const usd = totals.find((t) => t.currency === "USD")!;
    expect(usd.outstanding).toBe(1600); // A 1000 + B 300 + C 0 + F 300
    expect(totals.find((t) => t.currency === "IQD")!.outstanding).toBe(5000);
  });
});

// ── 38.6 Payables ───────────────────────────────────────────────────────────
describe("Payables report", () => {
  const stmts = [
    statement({ shipmentId: "S1", accountingStatus: "final_closed", items: [item({ id: "c1", totalAmount: 600, currency: "USD", supplierName: "Vendor A" })] }),
    statement({ shipmentId: "S2", accountingStatus: "draft", items: [item({ id: "c9", totalAmount: 999, currency: "USD", supplierName: "Vendor B" })] }), // unapproved → excluded
  ];
  const vp = (sid: string) => sid === "S1" ? [vendorPayment({ costItemId: "c1", amount: 250, currency: "USD" })] : [];
  const rows = buildPayableRows({ statements: stmts, vendorPaymentsByShipment: vp, asOfDate: "2026-02-10" });
  it("includes only approved statements' lines; partial line has remaining", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ approvedAmount: 600, paidAmount: 250, remainingAmount: 350, paymentStatus: "partially_paid" });
  });
  it("reversed vendor payment does not count as paid", () => {
    const rows2 = buildPayableRows({ statements: [stmts[0]], vendorPaymentsByShipment: () => [vendorPayment({ costItemId: "c1", amount: 600, status: "reversed" })], asOfDate: "2026-02-10" });
    expect(rows2[0].paidAmount).toBe(0);
    expect(rows2[0].paymentStatus).toBe("unpaid");
  });
  it("currencies stay separate in totals", () => {
    const multi = buildPayableRows({ statements: [statement({ items: [item({ id: "a", totalAmount: 100, currency: "USD" }), item({ id: "b", totalAmount: 200, currency: "EUR", supplierName: "V" })] })], vendorPaymentsByShipment: () => [], asOfDate: "2026-02-10" });
    const totals = summarizePayables(multi);
    expect(totals.map((t) => t.currency)).toEqual(["EUR", "USD"]);
    expect(totals.find((t) => t.currency === "EUR")!.approved).toBe(200);
  });
});

// ── 38.7 Cash Movement ──────────────────────────────────────────────────────
describe("Operational Cash Movement", () => {
  it("net = receipts − payments, per currency; reversed excluded", () => {
    const totals = buildCashMovement({
      customerPayments: [custPayment({ amount: 1000, currency: "USD" }), custPayment({ id: "r", amount: 500, currency: "USD", status: "reversed" }), custPayment({ id: "iq", amount: 9000, currency: "IQD" })],
      vendorPayments: [vendorPayment({ amount: 300, currency: "USD" }), vendorPayment({ id: "vr", amount: 100, currency: "USD", status: "reversed" })],
    });
    const usd = totals.find((t) => t.currency === "USD")!;
    expect(usd).toMatchObject({ customerReceipts: 1000, vendorPayments: 300, netCashMovement: 700 });
    expect(totals.find((t) => t.currency === "IQD")!.netCashMovement).toBe(9000);
  });
});

// ── 38.3-ish Receipts + Vendor payments reports ─────────────────────────────
describe("Customer receipts + vendor payments reports", () => {
  it("excludes reversed by default, includes on request, resolves order numbers", () => {
    const invById = (id: string) => id === "inv1" ? invoice({ id: "inv1", shipmentNumber: "MAR-2026-001" }) : undefined;
    const active = buildCustomerReceiptRows({ payments: [custPayment({ amount: 400, allocations: [{ invoiceId: "inv1", invoiceNumber: "N1", amount: 400 }] }), custPayment({ id: "rv", amount: 100, status: "reversed" })], invoicesById: invById, includeReversed: false });
    expect(active).toHaveLength(1);
    expect(active[0].orderRefs).toEqual(["MAR-2026-001"]);
    const all = buildCustomerReceiptRows({ payments: [custPayment({ amount: 400 }), custPayment({ id: "rv", amount: 100, status: "reversed" })], invoicesById: () => undefined, includeReversed: true });
    expect(all).toHaveLength(2);
    const totals = summarizeReceipts(all.map((r) => ({ currency: r.currency, amount: r.amount, status: r.status })));
    expect(totals[0]).toMatchObject({ active: 400, reversed: 100, count: 2 });
  });
  it("vendor payments report excludes reversed by default", () => {
    const rows = buildVendorPaymentRows({ payments: [vendorPayment({ amount: 300 }), vendorPayment({ id: "x", amount: 50, status: "reversed" })], includeReversed: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(300);
  });
});

// ── Profit report rows + financial closing report ───────────────────────────
describe("Profit report + financial closing report", () => {
  const stmts = [statement({ shipmentId: "S1", items: [item({ totalAmount: 600 })], financialStatus: "financial_closed", financialClosedAt: "2026-03-01T00:00:00Z" })];
  const invBy = (sid: string) => sid === "S1" ? [invoice({ sellingAmount: 1000, status: "issued" })] : [];
  it("profit rows carry available profit; totals only sum available", () => {
    const rows = buildProfitRows({ statements: stmts, invoicesByShipment: invBy, vendorPaymentsByShipment: () => [], customerPayments: [] });
    expect(rows[0]).toMatchObject({ officialProfit: 400, profitStatus: "available", currency: "USD" });
    expect(summarizeProfit(rows)[0].officialProfit).toBe(400);
  });
  it("financial closing report preserves metadata and stays available when closed", () => {
    const rows = buildFinancialClosingRows({ statements: stmts, invoicesByShipment: invBy, vendorPaymentsByShipment: () => [], customerPayments: [] });
    expect(rows[0]).toMatchObject({ financialStatus: "financial_closed", closedAt: "2026-03-01T00:00:00Z" });
  });
});

// ── 38.10 Read-only protection: pagination, sorting, filter validation ───────
describe("Pagination, sorting, filter validation", () => {
  it("normalizePaging clamps page size to the maximum", () => {
    expect(normalizePaging(0, 9999)).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
    expect(normalizePaging(3, 25)).toEqual({ page: 3, pageSize: 25 });
  });
  it("paginate returns totals for the whole set, not the page", () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ i }));
    const p = paginate(rows, 2, 20);
    expect(p).toMatchObject({ page: 2, pageSize: 20, totalItems: 55, totalPages: 3 });
    expect(p.rows).toHaveLength(20);
  });
  it("applySort rejects a non-whitelisted field (returns null → controlled 400)", () => {
    expect(applySort([{ a: 1 }], "evil; DROP", "asc", ["a"])).toBeNull();
    expect(applySort([{ a: 2 }, { a: 1 }], "a", "asc", ["a"])!.map((r) => r.a)).toEqual([1, 2]);
  });
  it("validateDateRange rejects malformed and inverted ranges", () => {
    expect(validateDateRange("2026-13-40", "").ok).toBe(false);
    expect(validateDateRange("2026-05-01", "2026-04-01").ok).toBe(false);
    expect(validateDateRange("2026-01-01", "2026-02-01")).toEqual({ ok: true, from: "2026-01-01", to: "2026-02-01" });
  });
});

// ── 38.11 CSV export ────────────────────────────────────────────────────────
describe("CSV export", () => {
  it("currency is its own column, numbers raw, UTF-8 names, formula-safe", () => {
    const csv = toCsv<{ name: string; amount: number; currency: string }>(
      [{ header: "name", value: (r) => r.name }, { header: "amount", value: (r) => r.amount }, { header: "currency", value: (r) => r.currency }],
      [{ name: "شركة", amount: 1000, currency: "USD" }, { name: "=cmd()", amount: 1500000, currency: "IQD" }],
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("name,amount,currency");
    expect(lines[1]).toBe("شركة,1000,USD");
    expect(lines[2]).toBe("'=cmd(),1500000,IQD");
  });
});

// ── 38.12 Legacy handling ───────────────────────────────────────────────────
describe("Legacy handling", () => {
  it("order without financialStatus defaults to financial_open; no payments → full remaining", () => {
    const s = buildOrderFinancialSummary({
      statement: statement({ financialStatus: undefined, items: [item({ totalAmount: 600 })] }),
      invoices: [invoice({ sellingAmount: 1000, status: "issued" })], customerPayments: [], vendorPayments: [], asOfDate: "2026-02-01",
    });
    expect(s.financialStatus).toBe("financial_open");
    expect(s.currencies.USD.customerRemaining).toBe(1000);
    expect(s.currencies.USD.vendorRemaining).toBe(600);
  });
  it("vendor identity: missing id falls back to name and never merges distinct vendors", () => {
    expect(vendorKeyOf({ supplierName: "Vendor A" })).toBe("name:vendor a");
    expect(vendorKeyOf({ vendorId: "v1", supplierName: "Vendor A" })).toBe("id:v1");
    expect(vendorKeyOf({ supplierName: "Vendor A" })).not.toBe(vendorKeyOf({ supplierName: "Vendor B" }));
  });
});
