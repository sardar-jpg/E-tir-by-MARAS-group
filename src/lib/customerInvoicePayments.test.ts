import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canRecordInvoicePayment, summarizeInvoiceReceivable, paymentsForInvoice,
  isInvoicePaymentEligibleStatus, canReversePayment,
} from "./customerPayments";
import { deriveInvoiceStatus } from "./invoiceLedger";
import { computeShipmentProfit } from "./costStatementMath";
import type { CustomerInvoice, CustomerPayment } from "../types";

/**
 * Accounting Phase 5 — per-invoice Customer Payments (Accounts Receivable).
 * A payment belongs to EXACTLY ONE issued invoice; paid/remaining/status are
 * derived from active payments only; invoice status advances automatically
 * (issued → partially_paid → paid); reversal excludes a payment from totals
 * but preserves history; customer cash timing never touches official profit.
 */

const invoice = (over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id: "inv1", invoiceNumber: "INV-MAR-2026-1001-01", shipmentId: "s1", shipmentNumber: "MAR-2026-1001",
  clientId: "client-1", companyName: "Acme Trading", currency: "USD", pricingMode: "manual",
  costBasis: 0, sellingAmount: 1000, status: "issued", createdAt: "2026-07-01T00:00:00Z", ...over,
});

const payment = (over: Partial<CustomerPayment> = {}): CustomerPayment => ({
  id: `p-${Math.random().toString(36).slice(2, 8)}`, companyName: "Acme Trading", clientId: "client-1",
  amount: 400, currency: "USD", paymentDate: "2026-07-10", paymentMethod: "bank_transfer",
  allocations: [{ invoiceId: "inv1", invoiceNumber: "INV-MAR-2026-1001-01", amount: 400 }],
  status: "active", createdBy: "acc1", createdAt: "2026-07-10T09:00:00Z", ...over,
});

describe("Phase 5 — payment eligibility (invoice statuses)", () => {
  it("issued and partially_paid are eligible; draft/cancelled/paid are not", () => {
    expect(isInvoicePaymentEligibleStatus("issued")).toBe(true);
    expect(isInvoicePaymentEligibleStatus("partially_paid")).toBe(true);
    expect(isInvoicePaymentEligibleStatus("draft")).toBe(false);
    expect(isInvoicePaymentEligibleStatus("cancelled")).toBe(false);
    expect(isInvoicePaymentEligibleStatus("paid")).toBe(false);
  });
  it("rejects draft, cancelled, and fully-paid invoices with a controlled code", () => {
    for (const status of ["draft", "cancelled", "paid"] as const) {
      const r = canRecordInvoicePayment({ invoice: invoice({ status }), amount: 100, currency: "USD", payments: [] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("invoice_not_receivable");
    }
  });
  it("rejects an unknown invoice", () => {
    const r = canRecordInvoicePayment({ invoice: null, amount: 100, currency: "USD", payments: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invoice_not_found");
  });
});

describe("Phase 5 — amount validation", () => {
  const base = { invoice: invoice(), payments: [] as CustomerPayment[] };
  it("accepts a positive partial amount and the exact remaining amount", () => {
    expect(canRecordInvoicePayment({ ...base, amount: 400, currency: "USD" }).ok).toBe(true);
    expect(canRecordInvoicePayment({ ...base, amount: 1000, currency: "USD" }).ok).toBe(true); // exact total
    // Exact remaining after a prior partial payment.
    const afterPartial = canRecordInvoicePayment({ invoice: invoice(), payments: [payment({ amount: 400 })], amount: 600, currency: "USD" });
    expect(afterPartial.ok).toBe(true);
  });
  it("rejects zero, negative, and non-numeric amounts", () => {
    for (const bad of [0, -5, NaN, "400", undefined]) {
      const r = canRecordInvoicePayment({ ...base, amount: bad, currency: "USD" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("invalid_amount");
    }
  });
  it("rejects overpayment (never an Overpaid state)", () => {
    const r = canRecordInvoicePayment({ invoice: invoice(), payments: [payment({ amount: 400 })], amount: 601, currency: "USD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("over_invoice");
  });
  it("rejects a currency mismatch (no FX, ever)", () => {
    const r = canRecordInvoicePayment({ ...base, amount: 100, currency: "IQD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("currency_mismatch");
  });
});

describe("Phase 5 — paid/remaining + derived payment status", () => {
  it("legacy invoice with no payments: paid 0, remaining = total, Unpaid, empty history", () => {
    const s = summarizeInvoiceReceivable(invoice(), []);
    expect(s).toMatchObject({ invoiceTotal: 1000, paidAmount: 0, remainingAmount: 1000, paymentStatus: "Unpaid", activePaymentCount: 0 });
    expect(paymentsForInvoice("inv1", [])).toEqual([]);
  });
  it("partial then full: 400 → Partially Paid (600 remaining); +600 → Paid (0 remaining)", () => {
    const p1 = payment({ id: "p1", amount: 400, allocations: [{ invoiceId: "inv1", invoiceNumber: "n", amount: 400 }] });
    const partial = summarizeInvoiceReceivable(invoice(), [p1]);
    expect(partial).toMatchObject({ paidAmount: 400, remainingAmount: 600, paymentStatus: "Partially Paid" });
    const p2 = payment({ id: "p2", amount: 600, allocations: [{ invoiceId: "inv1", invoiceNumber: "n", amount: 600 }] });
    const full = summarizeInvoiceReceivable(invoice(), [p1, p2]);
    expect(full).toMatchObject({ paidAmount: 1000, remainingAmount: 0, paymentStatus: "Paid", activePaymentCount: 2 });
  });
  it("totals are isolated per invoice — other invoices' payments never count", () => {
    const other = payment({ id: "px", allocations: [{ invoiceId: "OTHER", invoiceNumber: "o", amount: 999 }] });
    expect(summarizeInvoiceReceivable(invoice(), [other]).paidAmount).toBe(0);
  });
  it("reversed payments are excluded from totals but preserved in history", () => {
    const active = payment({ id: "pa", amount: 300, allocations: [{ invoiceId: "inv1", invoiceNumber: "n", amount: 300 }] });
    const reversed = payment({ id: "pr", amount: 200, status: "reversed", reversalReason: "typo", allocations: [{ invoiceId: "inv1", invoiceNumber: "n", amount: 200 }] });
    const s = summarizeInvoiceReceivable(invoice(), [active, reversed]);
    expect(s.paidAmount).toBe(300);
    expect(s.remainingAmount).toBe(700);
    expect(s.reversedPaymentCount).toBe(1);
    const history = paymentsForInvoice("inv1", [active, reversed]);
    expect(history).toHaveLength(2); // reversal never deletes history
    expect(history.some((r) => r.payment.status === "reversed")).toBe(true);
  });
  it("invoice status transitions derive automatically: issued → partially_paid → paid (and back on reversal)", () => {
    expect(deriveInvoiceStatus("issued", 1000, 0)).toBe("issued");
    expect(deriveInvoiceStatus("issued", 1000, 400)).toBe("partially_paid");
    expect(deriveInvoiceStatus("partially_paid", 1000, 1000)).toBe("paid");
    expect(deriveInvoiceStatus("paid", 1000, 400)).toBe("partially_paid"); // reversal reduces allocation
    expect(deriveInvoiceStatus("partially_paid", 1000, 0)).toBe("issued");
    // draft/cancelled are never touched by payment-derived status.
    expect(deriveInvoiceStatus("draft", 1000, 0)).toBe("draft");
    expect(deriveInvoiceStatus("cancelled", 1000, 0)).toBe("cancelled");
  });
});

describe("Phase 5 — reversal rules + history append", () => {
  it("reversal requires an active payment and a reason (never a delete)", () => {
    expect(canReversePayment(payment(), "typo").ok).toBe(true);
    expect(canReversePayment(payment(), "").ok).toBe(false);
    expect(canReversePayment(payment({ status: "reversed" }), "again").ok).toBe(false);
  });
  it("history rows keep amount, method, reference, note, recordedBy/At", () => {
    const p = payment({ reference: "TT-991", notes: "wire from Acme", createdBy: "acc1", createdAt: "2026-07-10T09:00:00Z" });
    const rows = paymentsForInvoice("inv1", [p]);
    expect(rows[0].allocatedAmount).toBe(400);
    expect(rows[0].payment).toMatchObject({ reference: "TT-991", notes: "wire from Acme", createdBy: "acc1", createdAt: "2026-07-10T09:00:00Z" });
  });
});

describe("Phase 5 — official profit is untouched by customer cash timing", () => {
  it("profit = issued invoice − approved cost, identical at 0%, partial, and full receipt", () => {
    const args = { issuedInvoiceTotal: 1000, invoiceCurrency: "USD" as const, costsApproved: true, approvedCostTotal: 700, costCurrency: "USD" as const };
    const before = computeShipmentProfit(args);
    expect(before.status).toBe("available");
    expect(before.profit).toBe(300);
    // Receiving 400 then the remaining 600 changes ONLY the receivable summary…
    const s = summarizeInvoiceReceivable(invoice(), [payment({ amount: 400 })]);
    expect(s.paymentStatus).toBe("Partially Paid");
    // …computeShipmentProfit has no paid-cash input: identical result.
    expect(computeShipmentProfit(args)).toEqual(before);
  });
});

// ── Route wiring (source scan, same style as the other wiring tests) ───────
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("Phase 5 — server wiring", () => {
  it("per-invoice payment routes exist with the granular customerPayments permissions (not Super Admin only)", () => {
    expect(SERVER).toContain('app.get("/api/customer-invoices/:invoiceId/payments", requirePermission("customerPayments.view")');
    expect(SERVER).toContain('app.post("/api/customer-invoices/:invoiceId/payments", requirePermission("customerPayments.create")');
    expect(SERVER).toContain('app.post("/api/customer-invoices/:invoiceId/payments/:paymentId/reverse", requirePermission("customerPayments.reverse")');
    expect(SERVER).not.toContain('customer-invoices/:invoiceId/payments", requireSuperAdmin');
  });
  it("create validates via the pure module, re-enforces atomically in the ledger tx, and restages invoice status", () => {
    const CREATE = region('app.post("/api/customer-invoices/:invoiceId/payments", requirePermission("customerPayments.create")', 4600);
    expect(CREATE).toContain("canRecordInvoicePayment({ invoice, amount: body.amount, currency: body.currency");
    expect(CREATE).toContain("applyAllocationDeltas({ payerClientId, currency: invoice.currency");
    expect(CREATE).toContain("stageInvoiceStatusUpdates(");
    expect(CREATE).toContain("allocations: [{ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amount }]");
    expect(CREATE).toContain("customerPaymentCreated");
  });
  it("the invoice-scoped reverse verifies the payment belongs to the invoice, then uses the SAME shared reversal core as the account route", () => {
    const REV = region('app.post("/api/customer-invoices/:invoiceId/payments/:paymentId/reverse"', 1200);
    expect(REV).toContain("payment_not_for_invoice");
    expect(REV).toContain("performCustomerPaymentReversal(req, req.params.paymentId, reason)");
    const ACCOUNT_REV = region('app.post("/api/customer-accounts/payments/:paymentId/reverse"', 700);
    expect(ACCOUNT_REV).toContain("performCustomerPaymentReversal(req, req.params.paymentId, reason)");
    // The shared core never deletes: it marks reversed + restores ledgers.
    const CORE = region("async function performCustomerPaymentReversal", 3600);
    expect(CORE).toContain('status: "reversed"');
    expect(CORE).toContain("applyAllocationDeltas(");
    expect(CORE).toContain("stageInvoiceStatusUpdates(");
  });
});
