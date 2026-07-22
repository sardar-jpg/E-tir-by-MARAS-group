import { describe, it, expect } from "vitest";
import { buildInsights, countByPriority } from "./accountingInsights";
import type { ReceivableRow, PayableRow } from "./receivablesPayables";
import { EMPTY_AGING } from "./receivablesPayables";
import type { CostStatement, CustomerInvoice } from "../types";

const rec = (o: Partial<ReceivableRow>): ReceivableRow => ({
  customer: "ABC", currency: "USD", totalInvoiced: 1000, totalReceived: 0, outstanding: 1000,
  dueAmount: 1000, overdueAmount: 0, oldestUnpaidDate: "2026-06-01", aging: { ...EMPTY_AGING, current: 1000 }, status: "current", ...o,
});
const pay = (o: Partial<PayableRow>): PayableRow => ({
  vendor: "Ven", currency: "USD", totalBills: 500, totalPaid: 0, outstanding: 500,
  dueAmount: 500, overdueAmount: 0, oldestUnpaidDate: "2026-06-01", aging: { ...EMPTY_AGING, current: 500 }, status: "current", ...o,
});
const cs = (o: Partial<CostStatement>): CostStatement => ({
  shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC", date: "2026-06-01",
  currency: "USD", totalCost: 500, paidAmount: 0, paymentStatus: "Unpaid", items: [{ id: "1", costType: "X", description: "", quantity: 1, unitPrice: 500, totalAmount: 500, currency: "USD", supplierName: "V" }],
  // agreedAmount is deliberately present in fixtures to prove insights IGNORE it.
  agreedAmount: 1000, agreedCurrency: "USD", accountingStatus: "final_closed", createdAt: "2026-06-01", ...o,
} as CostStatement);

// Issued customer invoice fixture (Accounting Phase 1 — the profit revenue source).
const inv = (o: Partial<CustomerInvoice>): CustomerInvoice => ({
  id: "inv", invoiceNumber: "MAR-2026-001", shipmentId: "s", shipmentNumber: "MAR-2026-001",
  companyName: "ABC", currency: "USD", pricingMode: "manual", costBasis: 0,
  sellingAmount: 1000, status: "issued", createdAt: "2026-06-10", ...o,
} as CustomerInvoice);

describe("buildInsights", () => {
  it("produces an executive summary per currency and never mixes currencies", () => {
    const ins = buildInsights({ receivables: [rec({ currency: "USD" }), rec({ currency: "EUR", customer: "X" })], payables: [], costStatements: [] });
    const summaries = ins.filter((i) => i.category === "Executive Financial Summary");
    expect(summaries.map((s) => s.impact?.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("flags overdue customers as critical when aged 60+ days", () => {
    const ins = buildInsights({
      receivables: [rec({ overdueAmount: 800, aging: { ...EMPTY_AGING, d90plus: 800 }, status: "overdue" })],
      payables: [], costStatements: [],
    });
    const alert = ins.find((i) => i.category === "Overdue Customer")!;
    expect(alert.priority).toBe("critical");
    expect(alert.impact).toEqual({ amount: 800, currency: "USD" });
    expect(alert.link?.tab).toBe("acct_customer_statements");
  });

  it("flags negative-profit (issued invoice − approved cost) as critical and invoiced-without-costs as medium", () => {
    const ins = buildInsights({
      receivables: [], payables: [],
      costStatements: [
        cs({ shipmentNumber: "MAR-2026-010", totalCost: 1500, agreedAmount: 9999 }),        // approved, cost 1500
        cs({ shipmentNumber: "MAR-2026-011", items: [], totalCost: 0, agreedAmount: 9999 }), // approved, no costs
      ],
      customerInvoices: [
        inv({ shipmentNumber: "MAR-2026-010", sellingAmount: 1000 }),  // 1000 − 1500 = -500 negative
        inv({ shipmentNumber: "MAR-2026-011", sellingAmount: 800 }),   // invoiced but no costs
      ],
    });
    const neg = ins.find((i) => i.category === "Negative Profit")!;
    expect(neg.priority).toBe("critical");
    expect(neg.link?.ref).toBe("MAR-2026-010");
    expect(neg.impact).toEqual({ amount: -500, currency: "USD" }); // agreedAmount (9999) is ignored
    const miss = ins.find((i) => i.category === "Missing Cost")!;
    expect(miss.priority).toBe("medium");
    expect(miss.link?.ref).toBe("MAR-2026-011");
  });

  it("does NOT flag negative/low profit when there is no issued invoice (profit is pending)", () => {
    const ins = buildInsights({
      receivables: [], payables: [],
      // High cost, big agreedAmount — but no issued invoice, so profit is pending.
      costStatements: [cs({ shipmentNumber: "MAR-2026-020", totalCost: 5000, agreedAmount: 100 })],
      customerInvoices: [],
    });
    expect(ins.find((i) => i.category === "Negative Profit")).toBeUndefined();
    expect(ins.find((i) => i.category === "Low Profit")).toBeUndefined();
    expect(ins.find((i) => i.category === "Missing Cost")).toBeUndefined();
  });

  it("ignores agreedAmount entirely — profit comes only from the issued invoice and approved cost", () => {
    const ins = buildInsights({
      receivables: [], payables: [],
      costStatements: [cs({ shipmentNumber: "MAR-2026-030", totalCost: 700, agreedAmount: 50 })],
      customerInvoices: [inv({ shipmentNumber: "MAR-2026-030", sellingAmount: 1000 })], // 1000 − 700 = +300, healthy
    });
    // agreedAmount 50 would have implied a huge loss under the old logic; new logic sees a healthy margin → no alert.
    expect(ins.find((i) => i.category === "Negative Profit")).toBeUndefined();
    expect(ins.find((i) => i.category === "Low Profit")).toBeUndefined();
  });

  it("raises a vendor due-soon action and sorts critical before info", () => {
    const ins = buildInsights({
      receivables: [rec({ overdueAmount: 500, status: "overdue", aging: { ...EMPTY_AGING, d1_30: 500 } })],
      payables: [pay({ status: "due_soon", dueAmount: 300 })],
      costStatements: [],
    });
    expect(ins.some((i) => i.category === "Vendor Payment" && i.priority === "medium")).toBe(true);
    // sorted: highest priority first
    expect(PRIORITY_LE(ins[0].priority, ins[ins.length - 1].priority)).toBe(true);
  });

  it("countByPriority tallies the buckets", () => {
    const ins = buildInsights({
      receivables: [rec({ overdueAmount: 800, aging: { ...EMPTY_AGING, d90plus: 800 }, status: "overdue" })],
      payables: [], costStatements: [],
    });
    const c = countByPriority(ins);
    expect(c.total).toBe(ins.length);
    expect(c.critical).toBeGreaterThanOrEqual(1);
  });
});

const RANK = { critical: 0, high: 1, medium: 2, info: 3 } as const;
function PRIORITY_LE(a: keyof typeof RANK, b: keyof typeof RANK) { return RANK[a] <= RANK[b]; }
