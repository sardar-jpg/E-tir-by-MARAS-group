import { describe, it, expect } from "vitest";
import { monthlyRevenueProfit, expenseByCategory, recentStatements, totalExpenses } from "./accountingDashboard";
import type { CostStatement, CustomerInvoice } from "../types";

const st = (over: Partial<CostStatement> = {}): CostStatement => ({
  shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC", date: "2026-06-10",
  currency: "USD", totalCost: 1000, paidAmount: 0, paymentStatus: "Unpaid",
  // agreedAmount kept only to prove it is IGNORED; profit needs an approved statement.
  agreedAmount: 9999, agreedCurrency: "USD", accountingStatus: "final_closed", items: [], createdAt: "2026-06-10",
  ...over,
} as any);

const inv = (shipmentNumber: string, sellingAmount: number, over: Partial<CustomerInvoice> = {}): CustomerInvoice =>
  ({ id: "inv-" + shipmentNumber, invoiceNumber: shipmentNumber, shipmentId: "x", shipmentNumber,
     companyName: "ABC", currency: "USD", pricingMode: "manual", costBasis: 0,
     sellingAmount, status: "issued", createdAt: "2026-06-10", ...over }) as CustomerInvoice;

describe("accountingDashboard view helpers", () => {
  it("monthlyRevenueProfit buckets INVOICE revenue/profit into trailing months, currency-safe", () => {
    const series = monthlyRevenueProfit([
      st({ date: "2026-06-01", shipmentNumber: "MAR-JUN", totalCost: 1000 }),
      st({ date: "2026-05-01", shipmentNumber: "MAR-MAY", totalCost: 800 }),
      st({ date: "2026-06-15", shipmentNumber: "MAR-EUR", totalCost: 400, currency: "EUR" }), // EUR invoice → excluded from USD chart
    ], [
      inv("MAR-JUN", 3000),
      inv("MAR-MAY", 2000),
      inv("MAR-EUR", 1000, { currency: "EUR" }),
    ], "USD", "2026-06-20", 6);
    expect(series).toHaveLength(6);
    const jun = series[series.length - 1];
    expect(jun.label).toBe("Jun");
    expect(jun.revenue).toBe(3000);   // EUR invoice excluded from the USD chart
    expect(jun.profit).toBe(2000);    // 3000 invoice − 1000 approved cost (agreedAmount 9999 ignored)
    const may = series[series.length - 2];
    expect(may.revenue).toBe(2000);
    expect(may.profit).toBe(1200);
  });
  it("a shipment without an issued invoice contributes no revenue or profit (pending)", () => {
    const series = monthlyRevenueProfit([st({ date: "2026-06-01", shipmentNumber: "MAR-X", totalCost: 1000 })], [], "USD", "2026-06-20", 3);
    const jun = series[series.length - 1];
    expect(jun.revenue).toBe(0);
    expect(jun.profit).toBe(0);
  });
  it("profit is excluded when invoice/cost currencies differ (never fabricated)", () => {
    const series = monthlyRevenueProfit(
      [st({ date: "2026-06-01", shipmentNumber: "MAR-M", currency: "EUR", totalCost: 1000 })],
      [inv("MAR-M", 3000)], // USD invoice, EUR cost
      "USD", "2026-06-20", 3);
    const jun = series[series.length - 1];
    expect(jun.revenue).toBe(3000);
    expect(jun.profit).toBe(0); // currency mismatch → profit unavailable, not added
  });
  it("expenseByCategory groups items by cost type with percentages", () => {
    const slices = expenseByCategory([st({ items: [
      { id: "1", costType: "Sea Freight", description: "", quantity: 1, unitPrice: 600, totalAmount: 600, currency: "USD", supplierName: "V" },
      { id: "2", costType: "Customs", description: "", quantity: 1, unitPrice: 400, totalAmount: 400, currency: "USD", supplierName: "V" },
      { id: "3", costType: "Sea Freight", description: "", quantity: 1, unitPrice: 400, totalAmount: 400, currency: "USD", supplierName: "V" },
    ] as any })], "USD");
    expect(slices[0]).toMatchObject({ category: "Sea Freight", amount: 1000, pct: 71 });
    expect(slices.find((s) => s.category === "Customs")?.amount).toBe(400);
  });
  it("recentStatements sorts newest first", () => {
    const r = recentStatements([st({ date: "2026-04-01", shipmentNumber: "A" }), st({ date: "2026-06-01", shipmentNumber: "B" })], 2);
    expect(r.map((s) => s.shipmentNumber)).toEqual(["B", "A"]);
  });
  it("totalExpenses sums item amounts in one currency", () => {
    expect(totalExpenses([st({ items: [
      { id: "1", costType: "X", description: "", quantity: 1, unitPrice: 600, totalAmount: 600, currency: "USD", supplierName: "V" },
      { id: "2", costType: "Y", description: "", quantity: 1, unitPrice: 900, totalAmount: 900, currency: "EUR", supplierName: "V" },
    ] as any })], "USD")).toBe(600);
  });
});
