import { describe, it, expect } from "vitest";
import { buildArOverview } from "./accountsReceivableOverview";
import type { CustomerInvoice, CustomerPayment } from "../types";

const inv = (id: string, amount: number, over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id, invoiceNumber: id, shipmentId: "s", shipmentNumber: "MAR", companyName: "Acme", currency: "USD",
  pricingMode: "manual", costBasis: 0, sellingAmount: amount, status: "issued", createdAt: "t", issuedAt: "t", ...over,
});
const pay = (amount: number, over: Partial<CustomerPayment> = {}): CustomerPayment => ({
  id: "p" + Math.random(), companyName: "Acme", amount, currency: "USD", paymentDate: "2026-02-01",
  paymentMethod: "wire", allocations: [], status: "active", createdBy: "u", createdAt: "t", ...over,
});

describe("AR dashboard overview (per currency, real data)", () => {
  it("computes invoiced/collected/outstanding and advance credit", () => {
    const invoices = [inv("I1", 5000), inv("I2", 3000, { currency: "EUR" })];
    const payments = [
      pay(6000, { allocations: [{ invoiceId: "I1", invoiceNumber: "I1", amount: 5000 }] }), // 1000 credit USD
      pay(1000, { currency: "EUR", allocations: [{ invoiceId: "I2", invoiceNumber: "I2", amount: 1000 }] }),
    ];
    const o = buildArOverview(invoices, payments);
    const usd = o.currencies.find((c) => c.currency === "USD")!;
    const eur = o.currencies.find((c) => c.currency === "EUR")!;
    expect(usd.totalInvoiced).toBe(5000);
    expect(usd.totalCollected).toBe(5000);
    expect(usd.totalOutstanding).toBe(0);
    expect(usd.advanceCredit).toBe(1000);
    expect(eur.totalOutstanding).toBe(2000);
  });
  it("counts drafts to issue and payments awaiting allocation", () => {
    const invoices = [inv("I1", 5000, { status: "draft" }), inv("I2", 3000)];
    const payments = [pay(1000), pay(2000, { allocations: [{ invoiceId: "I2", invoiceNumber: "I2", amount: 2000 }] })];
    const o = buildArOverview(invoices, payments);
    expect(o.draftInvoiceCount).toBe(1);
    expect(o.paymentsAwaitingAllocationCount).toBe(1); // the 1000 fully unallocated
  });
  it("excludes cancelled invoices and reversed payments", () => {
    const invoices = [inv("I1", 5000, { status: "cancelled" })];
    const payments = [pay(1000, { status: "reversed" })];
    const o = buildArOverview(invoices, payments);
    expect(o.currencies).toEqual([]);
    expect(o.paymentsAwaitingAllocationCount).toBe(0);
  });
});
