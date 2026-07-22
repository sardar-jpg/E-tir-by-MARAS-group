import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canRecordVendorPaymentForStatus, hasActiveVendorPayment, VENDOR_PAYMENT_ELIGIBLE_STATUS,
  summarizeVendorPayable, validateVendorPayment,
} from "./vendorPayments";
import {
  canRequestReopenChain, ACTIVE_VENDOR_PAYMENT_LOCK_MESSAGE, ACTIVE_INVOICE_LOCK_MESSAGE,
} from "./costApprovalWorkflow";
import { computeShipmentProfit } from "./costStatementMath";
import type { VendorPaymentTransaction } from "../types";

/**
 * Accounting Phase 4 — Vendor Payment workflow gates.
 *
 * The payment mechanics (targeting, currency match, overpayment refusal,
 * partial payments, derived status, append-only history, reversal, atomic
 * ledger) are covered by vendorPayments.test.ts, vendorPayableLedger.test.ts
 * and paymentConcurrency.test.ts. THIS file proves the Phase 4 additions:
 *   1. recording is eligible ONLY at final_closed,
 *   2. an active vendor payment blocks Reopen (its own lock, coexisting with
 *      the Phase 3 invoice lock),
 *   3. vendor payment timing never changes official profit,
 *   4. the server routes are wired to both gates.
 */

const pay = (over: Partial<VendorPaymentTransaction> = {}): VendorPaymentTransaction => ({
  id: "vp1", shipmentId: "s1", shipmentNumber: "MAR-2026-1001", costStatementId: "s1", costItemId: "i1",
  vendorName: "Zagros Carriers", amount: 400, currency: "USD", paymentDate: "2026-07-20", paymentMethod: "wire",
  createdBy: "acc1", createdAt: "t", status: "active", ...over,
});

describe("Phase 4 — payment eligibility (final_closed only)", () => {
  it("final_closed allows recording", () => {
    expect(VENDOR_PAYMENT_ELIGIBLE_STATUS).toBe("final_closed");
    expect(canRecordVendorPaymentForStatus("final_closed").ok).toBe(true);
  });
  it("every non-approved status blocks with a controlled error", () => {
    for (const s of ["draft", "pending_operations_approval", "pending_accounts_approval", "pending_managing_director_approval", "rejected_for_correction", "finalizing", "reopen_requested", "reopened", undefined] as const) {
      const r = canRecordVendorPaymentForStatus(s);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("statement_not_approved");
        expect(r.error).toContain("approved and closed");
      }
    }
  });
});

describe("Phase 4 — active vendor payment detection", () => {
  it("active payments count; reversed payments do not", () => {
    expect(hasActiveVendorPayment([])).toBe(false);
    expect(hasActiveVendorPayment([pay({ status: "reversed" })])).toBe(false);
    expect(hasActiveVendorPayment([pay({ status: "reversed" }), pay({ id: "vp2", status: "active" })])).toBe(true);
  });
});

describe("Phase 4 — reopen vendor-payment lock", () => {
  const base = { status: "final_closed" as const, hasActiveInvoice: false, hasPendingReopen: false, reason: "fix" };
  it("an active vendor payment blocks Reopen with the stable code + clear message", () => {
    const r = canRequestReopenChain({ ...base, hasActiveVendorPayment: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("active_vendor_payment_lock");
      expect(r.error).toBe(ACTIVE_VENDOR_PAYMENT_LOCK_MESSAGE);
    }
  });
  it("a cancelled (reversed) payment no longer blocks — Reopen becomes eligible", () => {
    expect(hasActiveVendorPayment([pay({ status: "reversed" })])).toBe(false);
    expect(canRequestReopenChain({ ...base, hasActiveVendorPayment: false }).ok).toBe(true);
  });
  it("both financial locks coexist; the invoice lock reports first, neither is weakened", () => {
    const both = canRequestReopenChain({ ...base, hasActiveInvoice: true, hasActiveVendorPayment: true });
    expect(both.ok).toBe(false);
    if (!both.ok) { expect(both.code).toBe("active_invoice_lock"); expect(both.error).toBe(ACTIVE_INVOICE_LOCK_MESSAGE); }
    // Clearing only the invoice still leaves the vendor-payment lock.
    const vendorOnly = canRequestReopenChain({ ...base, hasActiveInvoice: false, hasActiveVendorPayment: true });
    expect(vendorOnly.ok).toBe(false);
    if (!vendorOnly.ok) expect(vendorOnly.code).toBe("active_vendor_payment_lock");
    // Phase 3 behavior unchanged when the new flag is omitted (legacy callers).
    expect(canRequestReopenChain(base).ok).toBe(true);
  });
});

describe("Phase 4 — vendor payment timing never changes official profit", () => {
  it("profit = issued invoice − APPROVED cost, regardless of paid cash (0%, partial, full)", () => {
    const profitArgs = {
      issuedInvoiceTotal: 1500, invoiceCurrency: "USD" as const,
      costsApproved: true, approvedCostTotal: 1000, costCurrency: "USD" as const,
    };
    const before = computeShipmentProfit(profitArgs);
    expect(before.status).toBe("available");
    expect(before.profit).toBe(500); // 1500 − 1000 approved (not paid cash)

    // Record 200 paid, then full 1000 paid — the payable summary changes…
    const item = { id: "i1", totalAmount: 1000, currency: "USD" as const };
    const partial = summarizeVendorPayable(item, [pay({ amount: 200 })]);
    expect(partial.totalPaid).toBe(200);
    expect(partial.remaining).toBe(800);
    expect(partial.status).toBe("Partially Paid");
    const full = summarizeVendorPayable(item, [pay({ amount: 200 }), pay({ id: "vp2", amount: 800 })]);
    expect(full.status).toBe("Paid");
    expect(full.remaining).toBe(0);

    // …but computeShipmentProfit has NO paid-amount input at all: identical result.
    expect(computeShipmentProfit(profitArgs)).toEqual(before);
  });
  it("payment totals stay isolated per cost line and currency (no mixing, no FX)", () => {
    const usdItem = { id: "usd1", totalAmount: 1500, currency: "USD" as const };
    const iqdItem = { id: "iqd1", totalAmount: 3000000, currency: "IQD" as const };
    const payments = [
      pay({ id: "p1", costItemId: "usd1", amount: 500, currency: "USD" }),
      pay({ id: "p2", costItemId: "iqd1", amount: 1000000, currency: "IQD" }),
    ];
    const usd = summarizeVendorPayable(usdItem, payments);
    const iqd = summarizeVendorPayable(iqdItem, payments);
    expect(usd.totalPaid).toBe(500); expect(usd.remaining).toBe(1000);
    expect(iqd.totalPaid).toBe(1000000); expect(iqd.remaining).toBe(2000000);
    // A cross-currency payment against the USD line is refused (never converted).
    const r = validateVendorPayment({ item: usdItem, existingPayments: payments, amount: 100, currency: "IQD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("currency_mismatch");
  });
});

// ── Route wiring (source scan, same style as costApprovalRouteWiring) ──────
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("Phase 4 — server wiring", () => {
  it("recording a vendor payment requires final_closed (backend enforced, permission-gated, not super-only)", () => {
    const CREATE = region('app.post("/api/cost-statements/:shipmentId/vendor-payments", requirePermission("vendorPayments.create")', 1400);
    expect(CREATE).toContain("canRecordVendorPaymentForStatus(resolveAccountingStatus(stmt");
    expect(CREATE).toContain("eligibility.code");
    // The route is the granular permission, never requireSuperAdmin.
    expect(SERVER).not.toContain('vendor-payments", requireSuperAdmin');
  });
  it("the reopen request checks BOTH the invoice lock and the vendor-payment lock", () => {
    const REQ = region('app.post("/api/cost-statements/:shipmentId/reopen-request"', 2800);
    expect(REQ).toContain("hasActiveCustomerInvoice(await loadInvoicesForShipment(req.params.shipmentId))");
    expect(REQ).toContain("hasActiveVendorPayment(await loadVendorPaymentsForShipment(req.params.shipmentId))");
    expect(REQ).toContain("hasActiveVendorPayment: vendorPaymentActive");
  });
  it("reversal (payment cancellation) stays reason-required, permissioned, never a delete", () => {
    const REV = region('app.post("/api/cost-statements/:shipmentId/vendor-payments/:paymentId/reverse", requirePermission("vendorPayments.reverse")', 2400);
    expect(REV).toContain("canReverseVendorPayment(payment, reason)");
    expect(REV).toContain('status: "reversed"');
    // No delete route exists for vendor payments.
    expect(SERVER).not.toContain('app.delete("/api/cost-statements/:shipmentId/vendor-payments');
  });
});
