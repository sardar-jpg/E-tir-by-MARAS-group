import { describe, it, expect } from "vitest";
import { monthlyRevenueProfit, expenseByCategory, recentStatements, totalExpenses } from "./accountingDashboard";
import type { CostStatement } from "../types";

const st = (over: Partial<CostStatement> = {}): CostStatement => ({
  shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC", date: "2026-06-10",
  currency: "USD", totalCost: 1000, paidAmount: 0, paymentStatus: "Unpaid",
  agreedAmount: 3000, agreedCurrency: "USD", items: [], createdAt: "2026-06-10",
  ...over,
} as any);

describe("accountingDashboard view helpers", () => {
  it("monthlyRevenueProfit buckets real revenue/profit into trailing months, currency-safe", () => {
    const series = monthlyRevenueProfit([
      st({ date: "2026-06-01", agreedAmount: 3000, totalCost: 1000 }),
      st({ date: "2026-05-01", agreedAmount: 2000, totalCost: 800 }),
      st({ date: "2026-06-15", agreedAmount: 1000, totalCost: 400, agreedCurrency: "EUR", currency: "EUR" }), // other currency ignored
    ], "USD", "2026-06-20", 6);
    expect(series).toHaveLength(6);
    const jun = series[series.length - 1];
    expect(jun.label).toBe("Jun");
    expect(jun.revenue).toBe(3000);   // EUR statement excluded
    expect(jun.profit).toBe(2000);    // 3000 - 1000
    const may = series[series.length - 2];
    expect(may.revenue).toBe(2000);
  });
  it("profit is excluded when revenue/cost currencies differ (never fabricated)", () => {
    const series = monthlyRevenueProfit([st({ date: "2026-06-01", agreedAmount: 3000, agreedCurrency: "USD", currency: "EUR", totalCost: 1000 })], "USD", "2026-06-20", 3);
    const jun = series[series.length - 1];
    expect(jun.revenue).toBe(3000);
    expect(jun.profit).toBe(0); // computeGrossProfit returns null across currencies -> not added
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
