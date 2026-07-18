import { describe, it, expect } from "vitest";
import { buildExecutiveFinanceOverview, RECEIVABLE_OVERDUE_DAYS } from "./executiveFinance";
import type { CostStatement, Shipment } from "../types";

const NOW = "2026-07-18T12:00:00Z";

const shipment = (over: Partial<Shipment>): Shipment =>
  ({ id: "s1", shipmentNumber: "MAR-2026-1001", status: "Delivered", currency: "USD", agreedAmount: 500, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-18T09:00:00Z", ...over }) as unknown as Shipment;

const statement = (over: Partial<CostStatement>): CostStatement =>
  ({
    shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "Client Ltd", shipmentType: "land",
    date: "2026-07-18", currency: "USD", totalCost: 300, paidAmount: 300, remainingBalance: 0,
    paymentStatus: "Paid", customerReceivedAmount: 500, agreedAmount: 500, agreedCurrency: "USD",
    notes: "", items: [{ id: "i1", costType: "fuel", description: "Fuel", quantity: 1, unitPrice: 300, totalAmount: 300, currency: "USD", supplierName: "PO" }],
    createdAt: "t", updatedAt: "t", ...over,
  }) as CostStatement;

describe("executive finance — real accounting data, per currency, delivery-recognized", () => {
  it("revenue and gross profit bucket into today/month/year on the delivery date", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}), // delivered today: revenue 500, profit 200
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", totalCost: 100, agreedAmount: 400 }),
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2", updatedAt: "2026-07-02T09:00:00Z" })], // s2 delivered this month, not today
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue).toEqual({ today: 500, thisMonth: 900, thisYear: 900 });
    expect(usd.grossProfit).toEqual({ today: 200, thisMonth: 500, thisYear: 500 });
    expect(fin.deliveredWithStatementCount).toBe(2);
  });

  it("NEVER mixes currencies — each currency reports separately; mismatched profit is excluded and counted", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}),
        // Revenue agreed in EUR but costs in USD: profit must be EXCLUDED (computeGrossProfit refuses), never converted.
        statement({ shipmentId: "s3", shipmentNumber: "MAR-3", agreedCurrency: "EUR" as CostStatement["currency"], currency: "USD" }),
      ],
      [shipment({}), shipment({ id: "s3", shipmentNumber: "MAR-3" })],
      NOW
    );
    const eur = fin.currencies.find((c) => c.currency === "EUR")!;
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(eur.revenue.thisYear).toBe(500);
    expect(usd.revenue.thisYear).toBe(500); // only the matching-currency shipment
    expect(usd.grossProfit.thisYear).toBe(200);
    expect(eur.profitExcludedCount).toBe(1);
  });

  it("receivables: outstanding = agreed - received; overdue only when finished past the grace window", () => {
    const oldFinish = new Date(new Date(NOW).getTime() - (RECEIVABLE_OVERDUE_DAYS + 2) * 86400000).toISOString();
    const fin = buildExecutiveFinanceOverview(
      [
        statement({ customerReceivedAmount: 100 }), // outstanding 400, finished today -> not overdue
        statement({ shipmentId: "s4", shipmentNumber: "MAR-4", customerReceivedAmount: 0 }), // outstanding 500, finished long ago -> overdue
      ],
      [shipment({}), shipment({ id: "s4", shipmentNumber: "MAR-4", updatedAt: oldFinish })],
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
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.outstandingPayables).toBe(300);
    expect(usd.driverPayables).toBeCloseTo(200, 5);
    expect(usd.vendorPayables).toBeCloseTo(100, 5);
  });

  it("performance: average profit per shipment, top profit shipment this month, top revenue customer", () => {
    const fin = buildExecutiveFinanceOverview(
      [
        statement({}),
        statement({ shipmentId: "s2", shipmentNumber: "MAR-2", totalCost: 50, agreedAmount: 600, companyName: "Big Co" }),
      ],
      [shipment({}), shipment({ id: "s2", shipmentNumber: "MAR-2", agreedAmount: 600 })],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.averageProfitPerShipment).toBeCloseTo((200 + 550) / 2, 5);
    expect(usd.highestProfitShipmentThisMonth).toEqual({ shipmentNumber: "MAR-2", profit: 550 });
    expect(usd.highestRevenueCustomer).toEqual({ companyName: "Big Co", revenue: 600 });
  });

  it("undelivered shipments contribute receivables/payables but never revenue or profit", () => {
    const fin = buildExecutiveFinanceOverview(
      [statement({ customerReceivedAmount: 0, paidAmount: 100, remainingBalance: 200, paymentStatus: "Partial" })],
      [shipment({ status: "In Transit" })],
      NOW
    );
    const usd = fin.currencies.find((c) => c.currency === "USD")!;
    expect(usd.revenue.thisYear).toBe(0);
    expect(usd.grossProfit.thisYear).toBe(0);
    expect(usd.outstandingReceivables).toBe(500);
    expect(usd.outstandingPayables).toBe(200);
    expect(fin.deliveredWithStatementCount).toBe(0);
  });
});
