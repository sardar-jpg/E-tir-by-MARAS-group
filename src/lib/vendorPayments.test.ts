import { describe, it, expect } from "vitest";
import {
  summarizeVendorPayable,
  validateVendorPayment,
  canReverseVendorPayment,
  isDuplicateVendorPayment,
  matchesPayableFilter,
} from "./vendorPayments";
import type { CostItem, VendorPaymentTransaction } from "../types";

const item: Pick<CostItem, "id" | "totalAmount" | "currency"> = { id: "ci1", totalAmount: 10000, currency: "USD" };
const pay = (over: Partial<VendorPaymentTransaction>): VendorPaymentTransaction => ({
  id: "p" + Math.random(), shipmentId: "s1", shipmentNumber: "MAR-2026-1001", costStatementId: "s1",
  costItemId: "ci1", vendorName: "V", amount: 1000, currency: "USD", paymentDate: "2026-07-01",
  paymentMethod: "wire", createdBy: "u1", createdAt: "2026-07-01T00:00:00Z", status: "active", ...over,
});

describe("vendor payable summary (server-authoritative, partial payments)", () => {
  it("sums only active payments for the item and derives status", () => {
    // 10,000 paid as 4,000 + 3,000 + 3,000 → Paid.
    const payments = [pay({ amount: 4000 }), pay({ amount: 3000 }), pay({ amount: 3000 })];
    const s = summarizeVendorPayable(item, payments);
    expect(s.totalPaid).toBe(10000);
    expect(s.remaining).toBe(0);
    expect(s.status).toBe("Paid");
    expect(s.activePaymentCount).toBe(3);
  });
  it("partial and unpaid states", () => {
    expect(summarizeVendorPayable(item, [pay({ amount: 4000 })]).status).toBe("Partially Paid");
    expect(summarizeVendorPayable(item, []).status).toBe("Unpaid");
    expect(summarizeVendorPayable(item, [pay({ amount: 4000 })]).remaining).toBe(6000);
  });
  it("excludes reversed payments and other items", () => {
    const payments = [
      pay({ amount: 4000, status: "reversed" }),
      pay({ amount: 3000 }),
      pay({ amount: 9999, costItemId: "OTHER" }),
    ];
    const s = summarizeVendorPayable(item, payments);
    expect(s.totalPaid).toBe(3000);
    expect(s.reversedPaymentCount).toBe(1);
  });
  it("overpaid only when total exceeds cost", () => {
    expect(summarizeVendorPayable(item, [pay({ amount: 11000 })]).status).toBe("Overpaid");
  });
});

describe("payment validation", () => {
  it("rejects non-positive / non-finite amounts", () => {
    expect(validateVendorPayment({ item, existingPayments: [], amount: 0, currency: "USD" }).ok).toBe(false);
    expect(validateVendorPayment({ item, existingPayments: [], amount: -5, currency: "USD" }).ok).toBe(false);
    expect(validateVendorPayment({ item, existingPayments: [], amount: "5" as any, currency: "USD" }).ok).toBe(false);
  });
  it("rejects a currency mismatch with the cost line", () => {
    const r = validateVendorPayment({ item, existingPayments: [], amount: 100, currency: "EUR" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("currency_mismatch");
  });
  it("refuses overpayment unless explicitly allowed", () => {
    const existing = [pay({ amount: 9000 })];
    const over = validateVendorPayment({ item, existingPayments: existing, amount: 2000, currency: "USD" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("would_overpay");
    expect(validateVendorPayment({ item, existingPayments: existing, amount: 1000, currency: "USD" }).ok).toBe(true);
    expect(validateVendorPayment({ item, existingPayments: existing, amount: 2000, currency: "USD", allowOverpayment: true }).ok).toBe(true);
  });
  it("rejects a payment for a missing item", () => {
    expect(validateVendorPayment({ item: null, existingPayments: [], amount: 100, currency: "USD" }).ok).toBe(false);
  });
});

describe("reversal + duplicate guards", () => {
  it("only active payments with a reason can be reversed", () => {
    expect(canReverseVendorPayment(pay({}), "wrong account").ok).toBe(true);
    expect(canReverseVendorPayment(pay({ status: "reversed" }), "x").ok).toBe(false);
    expect(canReverseVendorPayment(pay({}), "  ").ok).toBe(false);
    expect(canReverseVendorPayment(null, "x").ok).toBe(false);
  });
  it("detects a duplicate submission (same item+amount+date+ref, active)", () => {
    const existing = [pay({ amount: 3000, paymentDate: "2026-07-01", reference: "TX9" })];
    expect(isDuplicateVendorPayment(existing, { costItemId: "ci1", amount: 3000, paymentDate: "2026-07-01", reference: "TX9" })).toBe(true);
    expect(isDuplicateVendorPayment(existing, { costItemId: "ci1", amount: 3000, paymentDate: "2026-07-02", reference: "TX9" })).toBe(false);
    // A reversed twin is not a duplicate.
    expect(isDuplicateVendorPayment([pay({ amount: 3000, paymentDate: "2026-07-01", reference: "TX9", status: "reversed" })], { costItemId: "ci1", amount: 3000, paymentDate: "2026-07-01", reference: "TX9" })).toBe(false);
  });
});

describe("payable filters", () => {
  const s = (over: any) => ({ costItemId: "ci1", currency: "USD" as const, costAmount: 100, totalPaid: 0, remaining: 100, status: "Unpaid" as const, activePaymentCount: 0, reversedPaymentCount: 0, ...over });
  it("buckets by status and overdue by due date", () => {
    expect(matchesPayableFilter(s({}), "unpaid", undefined, "2026-07-19T00:00:00Z")).toBe(true);
    expect(matchesPayableFilter(s({ status: "Partially Paid" }), "partial", undefined, "2026-07-19T00:00:00Z")).toBe(true);
    expect(matchesPayableFilter(s({ status: "Paid" }), "paid", undefined, "2026-07-19T00:00:00Z")).toBe(true);
    // Overdue: unpaid + past due date.
    expect(matchesPayableFilter(s({ status: "Unpaid" }), "overdue", "2026-07-01", "2026-07-19T00:00:00Z")).toBe(true);
    expect(matchesPayableFilter(s({ status: "Unpaid" }), "overdue", "2026-12-01", "2026-07-19T00:00:00Z")).toBe(false);
    // Fully paid is never overdue.
    expect(matchesPayableFilter(s({ status: "Paid" }), "overdue", "2026-07-01", "2026-07-19T00:00:00Z")).toBe(false);
  });
});
