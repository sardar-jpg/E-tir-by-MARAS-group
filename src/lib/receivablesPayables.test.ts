import { describe, it, expect } from "vitest";
import {
  daysOverdue, ageOpenItems, deriveStatus, buildReceivableRows, buildPayableRows,
  summarizeAging, filterAgingRows,
} from "./receivablesPayables";
import type { CustomerInvoice, CustomerPayment } from "../types";

const NOW = "2026-07-20";

describe("receivablesPayables aging", () => {
  it("daysOverdue counts whole days past the due date (negative before due)", () => {
    expect(daysOverdue("2026-07-10", NOW)).toBe(10);
    expect(daysOverdue("2026-07-25", NOW)).toBe(-5);
    expect(daysOverdue(undefined, NOW)).toBe(0);
  });

  it("ageOpenItems buckets by days overdue and splits due vs overdue", () => {
    const a = ageOpenItems([
      { outstanding: 100, dueDate: "2026-08-01", docDate: "2026-07-01" }, // not due -> current
      { outstanding: 50, dueDate: "2026-07-10", docDate: "2026-06-10" },  // 10 days -> 1-30
      { outstanding: 40, dueDate: "2026-06-01", docDate: "2026-05-01" },  // 49 days -> 31-60
      { outstanding: 30, dueDate: "2026-03-01", docDate: "2026-02-01" },  // >90 -> 90+
    ], NOW);
    expect(a.aging).toEqual({ current: 100, d1_30: 50, d31_60: 40, d61_90: 0, d90plus: 30 });
    expect(a.outstanding).toBe(220);
    expect(a.dueAmount).toBe(100);
    expect(a.overdueAmount).toBe(120);
    expect(a.oldestDocDate).toBe("2026-02-01");
  });

  it("deriveStatus prioritises paid > overdue > due_soon > partially_paid > current", () => {
    expect(deriveStatus(ageOpenItems([], NOW), 0, NOW)).toBe("paid");
    expect(deriveStatus(ageOpenItems([{ outstanding: 10, dueDate: "2026-07-01", docDate: "2026-06-01" }], NOW), 0, NOW)).toBe("overdue");
    expect(deriveStatus(ageOpenItems([{ outstanding: 10, dueDate: "2026-07-24", docDate: "2026-07-01" }], NOW), 0, NOW)).toBe("due_soon");
    expect(deriveStatus(ageOpenItems([{ outstanding: 10, dueDate: "2026-09-01", docDate: "2026-07-01" }], NOW), 5, NOW)).toBe("partially_paid");
    expect(deriveStatus(ageOpenItems([{ outstanding: 10, dueDate: "2026-09-01", docDate: "2026-07-01" }], NOW), 0, NOW)).toBe("current");
  });
});

const inv = (o: Partial<CustomerInvoice>): CustomerInvoice => ({
  id: "i", invoiceNumber: "MAR-2026-001", shipmentId: "s", shipmentNumber: "MAR-2026-001", companyName: "ABC",
  currency: "USD", pricingMode: "manual", costBasis: 0, sellingAmount: 1000, status: "issued", createdAt: "2026-06-01",
  ...o,
} as CustomerInvoice);
const pay = (o: Partial<CustomerPayment>): CustomerPayment => ({
  id: "p", companyName: "ABC", amount: 400, currency: "USD", paymentDate: "2026-06-20", paymentMethod: "wire",
  allocations: [], status: "active", createdBy: "x", createdAt: "2026-06-20", ...o,
} as CustomerPayment);

describe("buildReceivableRows", () => {
  it("builds one row per customer+currency, separates currencies, ages outstanding", () => {
    const rows = buildReceivableRows([{
      customer: "ABC",
      invoices: [
        inv({ id: "u1", currency: "USD", sellingAmount: 1000, dueDate: "2026-07-01", invoiceDate: "2026-06-01" }),
        inv({ id: "e1", currency: "EUR", sellingAmount: 500, dueDate: "2026-08-10", invoiceDate: "2026-07-05" }),
      ],
      outstanding: [
        { invoiceId: "u1", invoiceNumber: "MAR-2026-001", currency: "USD", amount: 1000, paid: 400, outstanding: 600, issuedAt: "2026-06-01" },
        { invoiceId: "e1", invoiceNumber: "MAR-2026-002", currency: "EUR", amount: 500, paid: 0, outstanding: 500, issuedAt: "2026-07-05" },
      ],
      payments: [pay({ currency: "USD", amount: 400 })],
    }], NOW);
    const usd = rows.find((r) => r.currency === "USD")!;
    expect(usd.totalInvoiced).toBe(1000);
    expect(usd.totalReceived).toBe(400);
    expect(usd.outstanding).toBe(600);
    expect(usd.overdueAmount).toBe(600); // due 2026-07-01 => 19 days overdue
    expect(usd.status).toBe("overdue");
    const eur = rows.find((r) => r.currency === "EUR")!;
    expect(eur.outstanding).toBe(500);
    expect(eur.overdueAmount).toBe(0); // not yet due
  });
});

describe("buildPayableRows", () => {
  it("groups bills per vendor+currency, nets paid, ages the remainder", () => {
    const rows = buildPayableRows([
      { vendor: "Ven", currency: "USD", amount: 1000, paid: 400, dueDate: "2026-07-01", docDate: "2026-06-01" },
      { vendor: "Ven", currency: "USD", amount: 500, paid: 500, dueDate: "2026-07-01", docDate: "2026-06-05" }, // fully paid
      { vendor: "Ven", currency: "EUR", amount: 200, paid: 0, dueDate: "2026-09-01", docDate: "2026-07-10" },
    ], NOW);
    const usd = rows.find((r) => r.currency === "USD")!;
    expect(usd.totalBills).toBe(1500);
    expect(usd.totalPaid).toBe(900);
    expect(usd.outstanding).toBe(600);
    expect(usd.overdueAmount).toBe(600);
    expect(usd.status).toBe("overdue");
    const eur = rows.find((r) => r.currency === "EUR")!;
    expect(eur.status).toBe("current");
  });
});

describe("summarize + filter", () => {
  const rows = buildPayableRows([
    { vendor: "Ven A", currency: "USD", amount: 1000, paid: 0, dueDate: "2026-07-01", docDate: "2026-06-01" },
    { vendor: "Ven B", currency: "USD", amount: 200, paid: 0, dueDate: "2026-09-01", docDate: "2026-07-10" },
    { vendor: "Ven C", currency: "EUR", amount: 300, paid: 0, dueDate: "2026-09-01", docDate: "2026-07-10" },
  ], NOW);

  it("summarizeAging rolls up per currency without mixing", () => {
    const s = summarizeAging(rows);
    const usd = s.find((x) => x.currency === "USD")!;
    expect(usd.totalOutstanding).toBe(1200);
    expect(usd.totalOverdue).toBe(1000);
    expect(s.find((x) => x.currency === "EUR")!.totalOutstanding).toBe(300);
  });

  it("filterAgingRows filters by currency, overdue and search", () => {
    expect(filterAgingRows(rows, { currency: "USD" }).length).toBe(2);
    expect(filterAgingRows(rows, { due: "overdue" }).length).toBe(1);
    expect(filterAgingRows(rows, { query: "ven b" }).length).toBe(1);
    // sorted by outstanding desc: Ven C (300) before Ven B (200)
    expect(filterAgingRows(rows, { status: "current" }).map((r) => r.vendor)).toEqual(["Ven C", "Ven B"]);
  });
});
