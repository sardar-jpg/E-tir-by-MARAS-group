import { describe, it, expect } from "vitest";
import { KeyedMutex } from "./asyncMutex";
import { validateAllocations, allocatedToInvoice } from "./customerPayments";
import { validateVendorPayment, summarizeVendorPayable } from "./vendorPayments";
import type { CustomerInvoice, CustomerPayment, VendorPaymentTransaction, CostItem } from "../types";

/**
 * Increment 2, items 1/2/4 → mandatory tests 1, 2, 4.
 *
 * These prove the invariant of the SERIALIZED critical section: when the
 * read→validate→write is serialized (KeyedMutex, per resource), the second
 * concurrent request re-reads the first's committed state and the SAME pure
 * validator the routes call (validateAllocations / validateVendorPayment)
 * rejects the excess. The mutex is deliberately exercised with real awaits so
 * the two operations genuinely overlap.
 */

const inv = (id: string, amount: number, clientId = "c1"): CustomerInvoice => ({
  id, invoiceNumber: id, shipmentId: "s", shipmentNumber: "MAR", clientId, companyName: "Acme", currency: "USD",
  pricingMode: "manual", costBasis: 0, sellingAmount: amount, status: "issued", createdAt: "t", issuedAt: "t",
});
const pay = (over: Partial<CustomerPayment>): CustomerPayment => ({
  id: "p" + Math.random(), clientId: "c1", companyName: "Acme", amount: 0, currency: "USD", paymentDate: "2026-02-01",
  paymentMethod: "wire", allocations: [], status: "active", createdBy: "u", createdAt: "t", ...over,
});

describe("two concurrent customer payments cannot over-allocate one invoice (tests 1 & 2)", () => {
  it("serialized create: only the amount an invoice can hold is ever allocated", async () => {
    const mutex = new KeyedMutex();
    const invoices = [inv("I1", 1000)];
    const payments: CustomerPayment[] = [];
    // Two requests each try to fully allocate 1000 to I1 (concurrently).
    const attempt = (id: string) =>
      mutex.run("c1", async () => {
        await Promise.resolve(); // force interleaving inside the critical section
        const v = validateAllocations({
          paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", paymentClientId: "c1",
          allocations: [{ invoiceId: "I1", amount: 1000 }], invoices, payments,
        });
        if (!v.ok) return { ok: false, code: v.code };
        payments.push(pay({ id, amount: 1000, allocations: v.allocations }));
        return { ok: true };
      });
    const [a, b] = await Promise.all([attempt("pA"), attempt("pB")]);
    // Exactly one succeeds; the other is rejected for over-allocation.
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(allocatedToInvoice("I1", payments)).toBe(1000); // never 2000
  });

  it("a payment cannot allocate to a different customer's invoice under load", async () => {
    const invoices = [inv("B1", 1000, "cB")];
    const v = validateAllocations({
      paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", paymentClientId: "cA",
      allocations: [{ invoiceId: "B1", amount: 500 }], invoices, payments: [],
    });
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("customer_mismatch");
  });
});

describe("two concurrent vendor payments cannot exceed the cost-item balance (test 4)", () => {
  it("serialized create: total active payments never exceed the item total", async () => {
    const mutex = new KeyedMutex();
    const item: CostItem = { id: "ci1", costType: "transport", description: "d", quantity: 1, unitPrice: 1000, totalAmount: 1000, currency: "USD", supplierName: "V" };
    const payments: VendorPaymentTransaction[] = [];
    const attempt = (id: string, amount: number) =>
      mutex.run("ci1", async () => {
        await Promise.resolve();
        const v = validateVendorPayment({ item, existingPayments: payments, amount, currency: "USD", allowOverpayment: false });
        if (!v.ok) return { ok: false, code: v.code };
        payments.push({ id, shipmentId: "s", shipmentNumber: "MAR", costStatementId: "s", costItemId: "ci1", vendorName: "V", amount: v.amount, currency: "USD", paymentDate: "d", paymentMethod: "wire", createdBy: "u", createdAt: "t", status: "active" });
        return { ok: true };
      });
    // Both try to pay the full 1000 concurrently.
    const [a, b] = await Promise.all([attempt("vA", 1000), attempt("vB", 1000)]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const summary = summarizeVendorPayable(item, payments);
    expect(summary.totalPaid).toBe(1000); // never 2000
    expect(summary.remaining).toBe(0);
  });

  it("partial payments are allowed up to — but never beyond — the item total", async () => {
    const mutex = new KeyedMutex();
    const item: CostItem = { id: "ci2", costType: "t", description: "d", quantity: 1, unitPrice: 1000, totalAmount: 1000, currency: "USD", supplierName: "V" };
    const payments: VendorPaymentTransaction[] = [];
    const attempt = (id: string, amount: number) =>
      mutex.run("ci2", async () => {
        await Promise.resolve();
        const v = validateVendorPayment({ item, existingPayments: payments, amount, currency: "USD", allowOverpayment: false });
        if (!v.ok) return { ok: false, code: v.code };
        payments.push({ id, shipmentId: "s", shipmentNumber: "MAR", costStatementId: "s", costItemId: "ci2", vendorName: "V", amount: v.amount, currency: "USD", paymentDate: "d", paymentMethod: "wire", createdBy: "u", createdAt: "t", status: "active" });
        return { ok: true };
      });
    // 700 + 700 → first ok (700), second rejected (would make 1400).
    const [a, b] = await Promise.all([attempt("vA", 700), attempt("vB", 700)]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1);
    expect(summarizeVendorPayable(item, payments).totalPaid).toBe(700);
  });
});
