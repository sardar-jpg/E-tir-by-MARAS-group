import { describe, it, expect } from "vitest";
import { invoiceTotal, summarizeInvoices, buildCashRegister, summarizeCash } from "./accountingRegisters";
import type { CustomerInvoice, CustomerPayment, VendorPaymentTransaction } from "../types";

const inv = (o: Partial<CustomerInvoice>): CustomerInvoice => ({
  id: "i", invoiceNumber: "MAR-1", shipmentId: "s", shipmentNumber: "MAR-1", companyName: "ABC",
  currency: "USD", pricingMode: "manual", costBasis: 0, sellingAmount: 1000, status: "issued", createdAt: "2026-01-01",
  ...o,
} as CustomerInvoice);

const cpay = (o: Partial<CustomerPayment>): CustomerPayment => ({
  id: "p", companyName: "ABC", amount: 500, currency: "USD", paymentDate: "2026-02-01", paymentMethod: "wire",
  allocations: [], status: "active", createdBy: "x", createdAt: "2026-02-01",
  ...o,
} as CustomerPayment);

const vpay = (o: Partial<VendorPaymentTransaction>): VendorPaymentTransaction => ({
  id: "v", shipmentId: "s", shipmentNumber: "MAR-1", costStatementId: "s", costItemId: "c", vendorName: "Ven",
  amount: 300, currency: "USD", paymentDate: "2026-02-03", paymentMethod: "wire", status: "active", createdBy: "x", createdAt: "2026-02-03",
  ...o,
} as VendorPaymentTransaction);

describe("accountingRegisters", () => {
  it("invoiceTotal prefers grandTotal, falls back to sellingAmount", () => {
    expect(invoiceTotal(inv({ sellingAmount: 1000 }))).toBe(1000);
    expect(invoiceTotal(inv({ sellingAmount: 1000, grandTotal: 1200 }))).toBe(1200);
  });

  it("summarizeInvoices tallies per currency, excludes cancelled money, counts outstanding", () => {
    const s = summarizeInvoices([
      inv({ currency: "USD", sellingAmount: 1000, status: "issued" }),
      inv({ currency: "USD", sellingAmount: 500, status: "partially_paid" }),
      inv({ currency: "USD", sellingAmount: 999, status: "cancelled" }),
      inv({ currency: "EUR", sellingAmount: 200, status: "paid" }),
    ]);
    const usd = s.find((x) => x.currency === "USD")!;
    expect(usd.invoiced).toBe(1500);        // cancelled excluded
    expect(usd.count).toBe(3);
    expect(usd.outstandingCount).toBe(2);   // issued + partially_paid
    expect(usd.byStatus.cancelled).toBe(1);
    expect(s.find((x) => x.currency === "EUR")!.invoiced).toBe(200);
  });

  it("buildCashRegister flattens inflow/outflow and sorts newest first", () => {
    const rows = buildCashRegister(
      [cpay({ id: "c1", paymentDate: "2026-02-01", allocations: [{ invoiceId: "i", invoiceNumber: "MAR-1", amount: 500 }] })],
      [vpay({ id: "v1", paymentDate: "2026-02-03" })],
    );
    expect(rows.map((r) => r.id)).toEqual(["v1", "c1"]); // newest first
    expect(rows.find((r) => r.id === "c1")).toMatchObject({ direction: "in", allocationsCount: 1 });
    expect(rows.find((r) => r.id === "v1")).toMatchObject({ direction: "out", orderRef: "MAR-1" });
  });

  it("summarizeCash nets inflow minus outflow per currency and ignores reversed", () => {
    const rows = buildCashRegister(
      [cpay({ amount: 500 }), cpay({ id: "c2", amount: 100, status: "reversed" })],
      [vpay({ amount: 300 })],
    );
    const usd = summarizeCash(rows).find((x) => x.currency === "USD")!;
    expect(usd.inflow).toBe(500);   // reversed 100 excluded
    expect(usd.outflow).toBe(300);
    expect(usd.net).toBe(200);
    expect(usd.count).toBe(2);
  });
});
