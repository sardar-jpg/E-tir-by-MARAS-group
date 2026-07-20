import { describe, it, expect } from "vitest";
import {
  monthKeyOf, prevMonthKey, computeMonthlyFigures, monthlyComparison, delta,
  topCustomersByRevenue, topExpenseCategories, reportCurrencies, type MonthlyInput,
} from "./monthlyReport";
import type { CustomerInvoice, CustomerPayment, VendorPaymentTransaction, CostStatement } from "../types";

const inv = (o: Partial<CustomerInvoice>): CustomerInvoice => ({
  id: "i", invoiceNumber: "MAR-2026-001", shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC",
  currency: "USD", pricingMode: "manual", costBasis: 0, sellingAmount: 1000, status: "issued", createdAt: "2026-06-01",
  invoiceDate: "2026-06-05", ...o,
} as CustomerInvoice);
const cpay = (o: Partial<CustomerPayment>): CustomerPayment => ({
  id: "p", companyName: "ABC", amount: 400, currency: "USD", paymentDate: "2026-06-10", paymentMethod: "wire",
  allocations: [], status: "active", createdBy: "x", createdAt: "2026-06-10", ...o,
} as CustomerPayment);
const vpay = (o: Partial<VendorPaymentTransaction>): VendorPaymentTransaction => ({
  id: "v", shipmentId: "s", shipmentNumber: "MAR-2026-001", costStatementId: "s", costItemId: "c", vendorName: "Ven",
  amount: 300, currency: "USD", paymentDate: "2026-06-12", paymentMethod: "wire", status: "active", createdBy: "x", createdAt: "2026-06-12", ...o,
} as VendorPaymentTransaction);
const cs = (o: Partial<CostStatement>): CostStatement => ({
  shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC", date: "2026-06-03",
  currency: "USD", totalCost: 0, paidAmount: 0, paymentStatus: "Unpaid", items: [], createdAt: "2026-06-03",
  ...o,
} as CostStatement);

describe("monthlyReport helpers", () => {
  it("monthKeyOf + prevMonthKey handle year boundaries", () => {
    expect(monthKeyOf("2026-06-15")).toBe("2026-06");
    expect(prevMonthKey("2026-06")).toBe("2026-05");
    expect(prevMonthKey("2026-01")).toBe("2025-12");
  });

  it("delta computes amount + pct (null when previous is zero)", () => {
    expect(delta(150, 100)).toEqual({ current: 150, previous: 100, amount: 50, pct: 50 });
    expect(delta(150, 0)).toEqual({ current: 150, previous: 0, amount: 150, pct: null });
  });
});

describe("computeMonthlyFigures", () => {
  const input: MonthlyInput = {
    invoices: [
      inv({ id: "a", companyName: "ABC", currency: "USD", sellingAmount: 1000, invoiceDate: "2026-06-05" }),
      inv({ id: "b", companyName: "XYZ", currency: "USD", sellingAmount: 500, invoiceDate: "2026-06-20" }),
      inv({ id: "c", companyName: "ABC", currency: "EUR", sellingAmount: 900, invoiceDate: "2026-06-07" }), // other currency
      inv({ id: "d", companyName: "ABC", currency: "USD", sellingAmount: 700, invoiceDate: "2026-05-30" }), // prev month
    ],
    customerPayments: [cpay({ amount: 400, paymentDate: "2026-06-10" }), cpay({ id: "p2", amount: 200, paymentDate: "2026-05-15" })],
    vendorPayments: [vpay({ amount: 300, paymentDate: "2026-06-12" })],
    costStatements: [
      cs({ shipmentId: "s1", date: "2026-06-03", currency: "USD", items: [
        { id: "1", costType: "Sea Freight", description: "", quantity: 1, unitPrice: 600, totalAmount: 600, currency: "USD", supplierName: "V" },
        { id: "2", costType: "Customs", description: "", quantity: 1, unitPrice: 200, totalAmount: 200, currency: "USD", supplierName: "V" },
      ] as any }),
      cs({ shipmentId: "s2", date: "2026-05-10", currency: "USD", items: [
        { id: "3", costType: "Sea Freight", description: "", quantity: 1, unitPrice: 400, totalAmount: 400, currency: "USD", supplierName: "V" },
      ] as any }),
    ],
    shipmentStatusById: { s1: "In Transit", s2: "Delivered" },
  };

  it("recognises revenue/expenses in the month, currency-safe", () => {
    const f = computeMonthlyFigures(input, "USD", "2026-06");
    expect(f.totalRevenue).toBe(1500);  // 1000 + 500 (EUR + prev-month excluded)
    expect(f.totalExpenses).toBe(800);  // 600 + 200 (May statement excluded)
    expect(f.grossProfit).toBe(700);
    expect(f.customerReceived).toBe(400);
    expect(f.vendorPaid).toBe(300);
  });

  it("closing balances are the position as of month-end (cumulative)", () => {
    const f = computeMonthlyFigures(input, "USD", "2026-06");
    // receivables: invoices<=end (1000+500+700=2200) - payments<=end (400+200=600) = 1600
    expect(f.closingReceivables).toBe(1600);
    // payables: items<=end (600+200+400=1200) - vendor paid<=end (300) = 900
    expect(f.closingPayables).toBe(900);
  });

  it("counts orders in the month and classifies completed vs open", () => {
    const f = computeMonthlyFigures(input, "USD", "2026-06");
    expect(f.totalOrders).toBe(1);      // only s1 dated in June (USD)
    expect(f.completedOrders).toBe(0);  // s1 is In Transit (open)
    expect(f.openOrders).toBe(1);
  });

  it("comparison vs previous month yields amount + pct", () => {
    const cur = computeMonthlyFigures(input, "USD", "2026-06");
    const prev = computeMonthlyFigures(input, "USD", "2026-05");
    const cmp = monthlyComparison(cur, prev);
    expect(prev.totalRevenue).toBe(700);
    expect(cmp.revenue.amount).toBe(800);   // 1500 - 700
    expect(cmp.revenue.pct).toBeCloseTo(114.29, 1);
    expect(cmp.expenses.current).toBe(800);
    expect(cmp.expenses.previous).toBe(400);
  });

  it("top customers + expense categories rank within the month/currency", () => {
    expect(topCustomersByRevenue(input.invoices, "USD", "2026-06")).toEqual([
      { name: "ABC", amount: 1000 }, { name: "XYZ", amount: 500 },
    ]);
    expect(topExpenseCategories(input.costStatements, "USD", "2026-06")).toEqual([
      { name: "Sea Freight", amount: 600 }, { name: "Customs", amount: 200 },
    ]);
    expect(reportCurrencies(input.invoices, input.costStatements)).toEqual(["EUR", "USD"]);
  });
});
