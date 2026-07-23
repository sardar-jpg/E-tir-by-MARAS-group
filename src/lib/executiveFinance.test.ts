import { describe, it, expect } from "vitest";
import { buildExecutiveFinanceOverview, isOpenShipmentStatus, RECEIVABLE_OVERDUE_DAYS } from "./executiveFinance";
import type { CostStatement, CustomerInvoice, Shipment } from "../types";

const NOW = "2026-07-18T12:00:00Z";

const shipment = (over: Partial<Shipment>): Shipment =>
  ({ id: "s1", shipmentNumber: "MAR-2026-1001", status: "Delivered", currency: "USD", agreedAmount: 500, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-18T09:00:00Z", ...over }) as unknown as Shipment;

// Accounting Phase 1: statements are approved (final_closed) so profit is
// recognized; agreedAmount is kept on the fixtures ONLY to prove it is ignored.
const statement = (over: Partial<CostStatement>): CostStatement =>
  ({
    shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "Client Ltd", shipmentType: "land",
    date: "2026-07-18", currency: "USD", totalCost: 300, paidAmount: 300, remainingBalance: 0,
    paymentStatus: "Paid", customerReceivedAmount: 500, agreedAmount: 9999, agreedCurrency: "USD",
    accountingStatus: "final_closed",
    notes: "", items: [{ id: "i1", costType: "fuel", description: "Fuel", quantity: 1, unitPrice: 300, totalAmount: 300, currency: "USD", supplierName: "PO" }],
    createdAt: "t", updatedAt: "t", ...over,
  }) as CostStatement;

// Issued customer invoice fixture — the ONLY source of revenue.
const inv = (shipmentNumber: string, sellingAmount: number, over: Partial<CustomerInvoice> = {}): CustomerInvoice =>
  ({ id: "inv-" + shipmentNumber, invoiceNumber: shipmentNumber, shipmentId: "x", shipmentNumber,
     companyName: "Client Ltd", currency: "USD", pricingMode: "manual", costBasis: 0,
     sellingAmount, status: "issued", createdAt: "2026-07-18", ...over }) as CustomerInvoice;

describe("executive finance — invoice-based revenue & profit, per currency, delivery-recognized", () => {
  it("revenue and profit bucket into today/month/year on the delivery date (from issued invoices)", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}), // invoice 500 − cost 300 = profit 200, delivered today
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", totalCost: 100 }), // invoice 400 − 100 = 300
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2", updatedAt: "2026-07-02T09:00:00Z" })],
      [inv("MAR-2026-1001", 500), inv("MAR-2", 400)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue).toEqual({ today: 500, thisMonth: 900, thisYear: 900 });
    expect(usd.grossProfit).toEqual({ today: 200, thisMonth: 500, thisYear: 500 });
    expect(fin.deliveredWithStatementCount).toBe(2);
  });

  it("agreedAmount is ignored — revenue and profit come only from the issued invoice", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({ agreedAmount: 1 })], // absurd agreed; must not appear anywhere
      [shipment({ agreedAmount: 1 })],
      [inv("MAR-2026-1001", 500)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue.thisYear).toBe(500); // invoice, not the agreed 1
    expect(usd.grossProfit.thisYear).toBe(200); // 500 − 300
  });

  it("a delivered shipment with NO issued invoice recognizes no revenue or profit (pending)", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({})],
      [shipment({})],
      [], // no invoice issued
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue.thisYear).toBe(0);
    expect(usd.grossProfit.thisYear).toBe(0);
    expect(usd.outstandingReceivables).toBe(0); // no invoice → no receivable
  });

  it("a cancelled/draft invoice is NOT revenue", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({})],
      [shipment({})],
      [inv("MAR-2026-1001", 500, { status: "cancelled" }), inv("MAR-2026-1001", 999, { status: "draft" })],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD");
    expect(usd?.revenue.thisYear ?? 0).toBe(0);
  });

  it("profit is excluded (not fabricated) when the cost statement is NOT approved", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({ accountingStatus: "draft" })], // invoice exists but costs unapproved
      [shipment({})],
      [inv("MAR-2026-1001", 500)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue.thisYear).toBe(500); // revenue still recognized from the issued invoice
    expect(usd.grossProfit.thisYear).toBe(0); // profit pending until approval
  });

  it("NEVER mixes currencies — mismatched invoice/cost profit is excluded and counted", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}),
        statement({ shipmentId: "s3", shipmentNumber: "MAR-3", currency: "USD" }),
      ],
      [shipment({}), shipment({ id: "s3", shipmentNumber: "MAR-3" })],
      [inv("MAR-2026-1001", 500), inv("MAR-3", 500, { currency: "EUR" })], // EUR invoice vs USD cost
      NOW
    );
    const eur = fin.currencies.find((c) => c.currency === "EUR")!;
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(eur.revenue.thisYear).toBe(500);
    expect(usd.revenue.thisYear).toBe(500);
    expect(usd.grossProfit.thisYear).toBe(200);
    expect(eur.profitExcludedCount).toBe(1);
  });

  it("receivables: outstanding = issued invoice − received; overdue only when finished past the grace window", () => {
    const oldFinish = new Date(new Date(NOW).getTime() - (RECEIVABLE_OVERDUE_DAYS + 2) * 86400000).toISOString();
    const fin = buildExecutiveFinanceOverview(
      [
        statement({ customerReceivedAmount: 100 }), // outstanding 400, finished today -> not overdue
        statement({ shipmentId: "s4", shipmentNumber: "MAR-4", customerReceivedAmount: 0 }), // outstanding 500, finished long ago -> overdue
      ],
      [shipment({}), shipment({ id: "s4", shipmentNumber: "MAR-4", updatedAt: oldFinish })],
      [inv("MAR-2026-1001", 500), inv("MAR-4", 500)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.outstandingReceivables).toBe(900);
    expect(usd.overdueReceivables).toBe(500);
    expect(usd.outstandingReceivableCount).toBe(2);
  });

  it("payables split by cost item type: driver items vs vendor items", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({
          paidAmount: 0, remainingBalance: 300, paymentStatus: "Unpaid",
          items: [
            { id: "i1", costType: "driver_payment", description: "Driver", quantity: 1, unitPrice: 200, totalAmount: 200, currency: "USD", supplierName: "Murat" },
            { id: "i2", costType: "customs", description: "Customs", quantity: 1, unitPrice: 100, totalAmount: 100, currency: "USD", supplierName: "Broker" },
          ],
        }),
      ],
      [shipment({})],
      [],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.outstandingPayables).toBe(300);
    expect(usd.driverPayables).toBeCloseTo(200, 5);
    expect(usd.vendorPayables).toBeCloseTo(100, 5);
  });

  it("performance: average profit per shipment, top profit shipment this month, top customer this month", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}),
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", totalCost: 50, companyName: "Big Co" }),
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2" })],
      [inv("MAR-2026-1001", 500), inv("MAR-2", 600)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.averageProfitPerShipment).toBeCloseTo((200 + 550) / 2, 5);
    expect(usd.highestProfitShipmentThisMonth).toEqual({ shipmentNumber: "MAR-2", profit: 550 });
    expect(usd.topCustomerThisMonth).toEqual({ companyName: "Big Co", shipmentCount: 1, revenue: 600, grossProfit: 550 });
  });

  it("Top Customer This Month ranks by GROSS PROFIT first — revenue alone never wins", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({ shipmentId: "s1", companyName: "Whale Ltd", totalCost: 1950 }), // invoice 2000 − 1950 = 50
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", companyName: "Lean Co", totalCost: 250 }), // 400 − 250 = 150
        statement({ shipmentId: "s3", shipmentNumber: "MAR-3", companyName: "Lean Co", totalCost: 250 }), // 400 − 250 = 150
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2" }), shipment({ id: "s3", shipmentNumber: "MAR-3" })],
      [inv("MAR-2026-1001", 2000), inv("MAR-2", 400), inv("MAR-3", 400)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.topCustomerThisMonth).toEqual({ companyName: "Lean Co", shipmentCount: 2, revenue: 800, grossProfit: 300 });
  });

  it("Top Customer ties break deterministically: equal profit -> higher revenue; equal both -> name order", () => {
    const equalProfit = buildExecutiveFinanceOverview(
      [
        statement({ shipmentId: "s1", companyName: "Alpha", totalCost: 300 }), // 500 − 300 = 200
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", companyName: "Beta", totalCost: 500 }), // 700 − 500 = 200, more revenue
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2" })],
      [inv("MAR-2026-1001", 500), inv("MAR-2", 700)],
      NOW
    );
    expect(equalProfit.currencies.find((c) => c.currency === "USD")!.topCustomerThisMonth!.companyName).toBe("Beta");

    const fullTie = buildExecutiveFinanceOverview(
      [
        statement({ shipmentId: "s1", companyName: "Zeta" }),
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", companyName: "Alpha" }),
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2" })],
      [inv("MAR-2026-1001", 500), inv("MAR-2", 500)],
      NOW
    );
    expect(fullTie.currencies.find((c) => c.currency === "USD")!.topCustomerThisMonth!.companyName).toBe("Alpha");
  });

  it("Top Customer only counts THIS MONTH's deliveries", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({ shipmentId: "s1", companyName: "Old Glory", totalCost: 100 }), // delivered in June
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", companyName: "Fresh Co" }), // delivered today
      ],
      [shipment({ updatedAt: "2026-06-10T09:00:00Z" }), shipment({ id: "s2", shipmentNumber: "MAR-2" })],
      [inv("MAR-2026-1001", 900), inv("MAR-2", 500)],
      NOW
    );
    expect(fin.currencies.find((c) => c.currency === "USD")!.topCustomerThisMonth!.companyName).toBe("Fresh Co");
  });

  it("Open Shipments Value: agreed value of non-terminal shipments (operational pipeline, never revenue)", () => {
    const fin = buildExecutiveFinanceOverview(
      [],
      [
        shipment({ status: "In Transit", agreedAmount: 700 }),
        shipment({ id: "s2", shipmentNumber: "MAR-2", status: "New", agreedAmount: 300 }),
        shipment({ id: "s3", shipmentNumber: "MAR-3", status: "Loading", agreedAmount: 250, currency: "EUR" as Shipment["currency"] }),
        shipment({ id: "s4", shipmentNumber: "MAR-4", status: "Delivered", agreedAmount: 9999 }), // terminal -> excluded
        shipment({ id: "s5", shipmentNumber: "MAR-5", status: "Closed", agreedAmount: 8888 }), // terminal -> excluded
      ],
      [],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    const eur = fin.currencies.find((c) => c.currency === "EUR")!;
    // Open Shipments Value is the agreed value of in-flight work — an operational
    // pipeline figure, NOT revenue/profit/margin/receivable.
    expect(usd.openShipmentsValue).toBe(1000);
    expect(usd.openShipmentsCount).toBe(2);
    expect(eur.openShipmentsValue).toBe(250);
    expect(eur.openShipmentsCount).toBe(1);
    expect(usd.revenue).toEqual({ today: 0, thisMonth: 0, thisYear: 0 });
    expect(eur.revenue).toEqual({ today: 0, thisMonth: 0, thisYear: 0 });
    expect(isOpenShipmentStatus("In Transit")).toBe(true);
    expect(isOpenShipmentStatus("Delivered")).toBe(false);
    expect(isOpenShipmentStatus("Completed")).toBe(false);
  });

  it("undelivered shipments contribute receivables/payables (once invoiced) but never revenue or profit", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({ customerReceivedAmount: 0, paidAmount: 100, remainingBalance: 200, paymentStatus: "Partial" })],
      [shipment({ status: "In Transit" })],
      [inv("MAR-2026-1001", 500)], // invoice issued while still in transit
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue.thisYear).toBe(0);
    expect(usd.grossProfit.thisYear).toBe(0);
    expect(usd.outstandingReceivables).toBe(500);
    expect(usd.outstandingPayables).toBe(200);
    expect(fin.deliveredWithStatementCount).toBe(0);
  });

  it("Net Exposure (per currency) = outstanding receivables − outstanding payables; never mixed", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({
        customerReceivedAmount: 100, // invoice 500 − 100 received → 400 outstanding
        paidAmount: 0, remainingBalance: 300, paymentStatus: "Unpaid",
        items: [{ id: "i1", costType: "customs", description: "Customs", quantity: 1, unitPrice: 300, totalAmount: 300, currency: "USD", supplierName: "Broker" }],
      })],
      [shipment({})],
      [inv("MAR-2026-1001", 500)],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.outstandingReceivables).toBe(400);
    expect(usd.outstandingPayables).toBe(300);
    expect(usd.netExposure).toBe(100); // 400 − 300

    // Owing more than owed → negative exposure (sign is preserved, never flipped).
    const owingMore = buildExecutiveFinanceOverview(
      [statement({
        paidAmount: 0, remainingBalance: 300, paymentStatus: "Unpaid",
        items: [{ id: "i1", costType: "customs", description: "Customs", quantity: 1, unitPrice: 300, totalAmount: 300, currency: "USD", supplierName: "Broker" }],
      })],
      [shipment({})],
      [], // no invoice → no receivable
      NOW
    );
    expect(owingMore.currencies.find((c) => c.currency === "USD")!.netExposure).toBe(-300);
  });
});
