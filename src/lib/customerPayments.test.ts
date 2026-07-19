import { describe, it, expect } from "vitest";
import {
  allocatedToInvoice,
  buildOutstandingList,
  autoAllocate,
  validateAllocations,
  canReversePayment,
  isDuplicatePayment,
  summarizeCustomerAccount,
} from "./customerPayments";
import type { CustomerInvoice, CustomerPayment } from "../types";

const inv = (id: string, amount: number, over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id, invoiceNumber: id, shipmentId: "s", shipmentNumber: "MAR", companyName: "Acme", currency: "USD",
  pricingMode: "manual", costBasis: 0, sellingAmount: amount, status: "issued", createdAt: "2026-01-01T00:00:00Z",
  issuedAt: "2026-01-01T00:00:00Z", ...over,
});
const payment = (over: Partial<CustomerPayment>): CustomerPayment => ({
  id: "p" + Math.random(), companyName: "Acme", amount: 0, currency: "USD", paymentDate: "2026-02-01",
  paymentMethod: "wire", allocations: [], status: "active", createdBy: "u", createdAt: "2026-02-01T00:00:00Z", ...over,
});

describe("allocation of one payment across invoices (spec example)", () => {
  // Invoice 1: 5000, Invoice 2: 3000, Invoice 3: 7000; pay 10000 → I1 paid,
  // I2 paid, I3 gets 2000 (5000 remaining).
  const invoices = [inv("I1", 5000, { issuedAt: "2026-01-01T00:00:00Z" }), inv("I2", 3000, { issuedAt: "2026-01-02T00:00:00Z" }), inv("I3", 7000, { issuedAt: "2026-01-03T00:00:00Z" })];
  it("auto-allocates oldest-first with the correct leftover", () => {
    const outstanding = buildOutstandingList(invoices, []);
    const { allocations, unallocated } = autoAllocate(10000, "USD", outstanding);
    expect(allocations).toEqual([
      { invoiceId: "I1", invoiceNumber: "I1", amount: 5000 },
      { invoiceId: "I2", invoiceNumber: "I2", amount: 3000 },
      { invoiceId: "I3", invoiceNumber: "I3", amount: 2000 },
    ]);
    expect(unallocated).toBe(0);
    // Applying it: I3 remaining 5000.
    const applied = [payment({ amount: 10000, allocations })];
    expect(allocatedToInvoice("I3", applied)).toBe(2000);
    expect(buildOutstandingList(invoices, applied).find((o) => o.invoiceId === "I3")!.outstanding).toBe(5000);
  });
  it("overpayment leaves advance credit (unallocated)", () => {
    const outstanding = buildOutstandingList([inv("I1", 5000)], []);
    const { allocations, unallocated } = autoAllocate(8000, "USD", outstanding);
    expect(allocations).toEqual([{ invoiceId: "I1", invoiceNumber: "I1", amount: 5000 }]);
    expect(unallocated).toBe(3000);
  });
  it("only allocates to same-currency invoices", () => {
    const outstanding = buildOutstandingList([inv("E1", 100, { currency: "EUR" })], []);
    expect(autoAllocate(100, "USD", outstanding).allocations).toEqual([]);
  });
});

describe("manual allocation validation", () => {
  const invoices = [inv("I1", 5000), inv("I2", 3000)];
  it("rejects over-invoice, over-payment, wrong currency, missing/non-billable invoice", () => {
    expect(validateAllocations({ paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 6000 }], invoices, payments: [] }).ok).toBe(false); // over invoice
    expect(validateAllocations({ paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 2000 }], invoices, payments: [] }).ok).toBe(false); // over payment
    expect(validateAllocations({ paymentId: null, paymentAmount: 1000, paymentCurrency: "EUR", allocations: [{ invoiceId: "I1", amount: 500 }], invoices, payments: [] }).ok).toBe(false); // currency
    expect(validateAllocations({ paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", allocations: [{ invoiceId: "NOPE", amount: 500 }], invoices, payments: [] }).ok).toBe(false); // missing
    expect(validateAllocations({ paymentId: null, paymentAmount: 1000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 0 }], invoices, payments: [] }).ok).toBe(false); // non-positive
    const ok = validateAllocations({ paymentId: null, paymentAmount: 5000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 5000 }], invoices, payments: [] });
    expect(ok.ok).toBe(true);
  });
  it("re-allocation of a payment counts its own prior split as available", () => {
    // Payment P already allocates 5000 to I1 (fully paid). Editing P to move
    // 2000 to I2 and 3000 to I1 must be allowed (its own 5000 frees up).
    const P = payment({ id: "P", amount: 5000, allocations: [{ invoiceId: "I1", invoiceNumber: "I1", amount: 5000 }] });
    const r = validateAllocations({ paymentId: "P", paymentAmount: 5000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 3000 }, { invoiceId: "I2", amount: 2000 }], invoices, payments: [P] });
    expect(r.ok).toBe(true);
  });
  it("rejects duplicate allocation to the same invoice within one payment", () => {
    expect(validateAllocations({ paymentId: null, paymentAmount: 5000, paymentCurrency: "USD", allocations: [{ invoiceId: "I1", amount: 1000 }, { invoiceId: "I1", amount: 1000 }], invoices, payments: [] }).ok).toBe(false);
  });
});

describe("reversal excludes a payment from all balances", () => {
  it("reversed payments do not count toward paid/allocations", () => {
    const invoices = [inv("I1", 5000)];
    const active = [payment({ amount: 5000, allocations: [{ invoiceId: "I1", invoiceNumber: "I1", amount: 5000 }] })];
    expect(allocatedToInvoice("I1", active)).toBe(5000);
    const reversed = active.map((p) => ({ ...p, status: "reversed" as const }));
    expect(allocatedToInvoice("I1", reversed)).toBe(0);
    expect(buildOutstandingList(invoices, reversed)[0].outstanding).toBe(5000);
  });
  it("reversal + duplicate guards", () => {
    expect(canReversePayment(payment({}), "wrong").ok).toBe(true);
    expect(canReversePayment(payment({ status: "reversed" }), "x").ok).toBe(false);
    expect(canReversePayment(payment({}), " ").ok).toBe(false);
    const existing = [payment({ amount: 1000, paymentDate: "2026-02-01", reference: "R1" })];
    expect(isDuplicatePayment(existing, { companyName: "Acme", amount: 1000, paymentDate: "2026-02-01", reference: "R1", currency: "USD" })).toBe(true);
    expect(isDuplicatePayment(existing, { companyName: "Acme", amount: 1000, paymentDate: "2026-02-02", reference: "R1", currency: "USD" })).toBe(false);
  });
});

describe("per-currency account summary (never mixes currencies)", () => {
  it("splits invoiced/paid/outstanding/credit by currency", () => {
    const invoices = [inv("U1", 5000, { currency: "USD" }), inv("E1", 1000, { currency: "EUR" }), inv("C1", 2000, { currency: "USD", status: "cancelled" })];
    const payments = [
      payment({ amount: 6000, currency: "USD", allocations: [{ invoiceId: "U1", invoiceNumber: "U1", amount: 5000 }] }), // 1000 credit
      payment({ amount: 500, currency: "EUR", allocations: [{ invoiceId: "E1", invoiceNumber: "E1", amount: 500 }] }),
    ];
    const s = summarizeCustomerAccount(invoices, payments);
    const usd = s.find((x) => x.currency === "USD")!;
    const eur = s.find((x) => x.currency === "EUR")!;
    expect(usd.invoicedTotal).toBe(5000); // cancelled excluded
    expect(usd.paidTotal).toBe(5000);
    expect(usd.outstandingTotal).toBe(0);
    expect(usd.unallocatedCredit).toBe(1000);
    expect(eur.invoicedTotal).toBe(1000);
    expect(eur.outstandingTotal).toBe(500);
  });
});
