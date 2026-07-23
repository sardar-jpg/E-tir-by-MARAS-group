import { describe, it, expect } from "vitest";
import {
  REQUIRED_SNAPSHOT_CURRENCIES,
  SNAPSHOT_METRIC_ORDER,
  snapshotCurrencyTabs,
  currencySnapshot,
  formatSnapshotAmount,
} from "./financialSnapshot";
import type { CurrencyFinanceOverview, ExecutiveFinanceOverview } from "./executiveFinance";

/** Minimal CurrencyFinanceOverview block with only the fields the snapshot reads. */
const block = (currency: string, over: Partial<CurrencyFinanceOverview> = {}): CurrencyFinanceOverview =>
  ({
    currency,
    revenue: { today: 0, thisMonth: 0, thisYear: 0 },
    grossProfit: { today: 0, thisMonth: 0, thisYear: 0 },
    profitExcludedCount: 0,
    outstandingReceivables: 0,
    overdueReceivables: 0,
    outstandingReceivableCount: 0,
    outstandingPayables: 0,
    driverPayables: 0,
    vendorPayables: 0,
    openShipmentsValue: 0,
    openShipmentsCount: 0,
    netExposure: 0,
    averageProfitPerShipment: null,
    highestProfitShipmentThisMonth: null,
    topCustomerThisMonth: null,
    ...over,
  }) as CurrencyFinanceOverview;

const overview = (currencies: CurrencyFinanceOverview[]): ExecutiveFinanceOverview =>
  ({ currencies, statementCount: 0, deliveredWithStatementCount: 0 });

describe("financialSnapshot — currency tabs", () => {
  it("always offers USD, TRY, IQD in that fixed order (even with no data at all)", () => {
    expect([...REQUIRED_SNAPSHOT_CURRENCIES]).toEqual(["USD", "TRY", "IQD"]);
    expect(snapshotCurrencyTabs(null)).toEqual(["USD", "TRY", "IQD"]);
    expect(snapshotCurrencyTabs(overview([]))).toEqual(["USD", "TRY", "IQD"]);
  });

  it("defaults to USD (the first required currency)", () => {
    expect(snapshotCurrencyTabs(null)[0]).toBe("USD");
  });

  it("shows the selected currency's own records when switching to IQD (large amounts intact)", () => {
    const ov = overview([block("IQD", { outstandingReceivables: 354270000, vendorPayables: 12000000, openShipmentsValue: 900000000, netExposure: 342270000 })]);
    const iqd = currencySnapshot(ov, "IQD");
    expect(iqd.hasData).toBe(true);
    expect(iqd.metrics.receivables).toBe(354270000);
    expect(formatSnapshotAmount(iqd.metrics.receivables, "en")).toBe("354,270,000");
  });

  it("keeps IQD visible even when every IQD value is zero (never hidden at zero)", () => {
    const tabs = snapshotCurrencyTabs(overview([block("USD", { outstandingReceivables: 100 })]));
    expect(tabs).toContain("IQD");
    const iqd = currencySnapshot(overview([block("USD", { outstandingReceivables: 100 })]), "IQD");
    expect(iqd.metrics).toEqual({ receivables: 0, vendorPayables: 0, openShipmentValue: 0, netExposure: 0 });
    expect(iqd.hasData).toBe(false);
  });

  it("appends any OTHER currency that has records (e.g. EUR) AFTER the required three — real money is never hidden", () => {
    const tabs = snapshotCurrencyTabs(overview([block("EUR", { outstandingReceivables: 42 }), block("USD")]));
    expect(tabs).toEqual(["USD", "TRY", "IQD", "EUR"]);
  });
});

describe("financialSnapshot — per-currency rows (never mixed)", () => {
  it("maps the four rows from the selected currency's bucket only", () => {
    const ov = overview([
      block("USD", { outstandingReceivables: 3200, vendorPayables: 6410, openShipmentsValue: 247254, netExposure: 3210 }),
      block("TRY", { outstandingReceivables: 85420, vendorPayables: 1000, openShipmentsValue: 500000, netExposure: 84420 }),
    ]);
    const usd = currencySnapshot(ov, "USD");
    expect(usd.hasData).toBe(true);
    expect(usd.metrics).toEqual({ receivables: 3200, vendorPayables: 6410, openShipmentValue: 247254, netExposure: 3210 });

    // Switching to TRY reads a DIFFERENT bucket — values never combine with USD.
    const tryS = currencySnapshot(ov, "TRY");
    expect(tryS.metrics.receivables).toBe(85420);
    expect(tryS.metrics.openShipmentValue).toBe(500000);
    expect(tryS.metrics.receivables + 0).not.toBe(usd.metrics.receivables); // distinct, unmixed
  });

  it("a currency with no bucket returns clean zeros, not a fabricated value", () => {
    const snap = currencySnapshot(overview([block("USD", { netExposure: 999 })]), "IQD");
    expect(snap.currency).toBe("IQD");
    expect(snap.hasData).toBe(false);
    expect(snap.metrics.netExposure).toBe(0);
  });

  it("renders the four rows in the reference order", () => {
    expect([...SNAPSHOT_METRIC_ORDER]).toEqual(["receivables", "vendorPayables", "openShipmentValue", "netExposure"]);
  });
});

describe("financialSnapshot — locale-safe amount formatting", () => {
  it("groups thousands and omits unnecessary decimals (USD/TRY examples)", () => {
    expect(formatSnapshotAmount(247254, "en")).toBe("247,254");
    expect(formatSnapshotAmount(85420, "en")).toBe("85,420");
    expect(formatSnapshotAmount(0, "en")).toBe("0");
  });

  it("formats very large IQD amounts without exponent or clipping", () => {
    expect(formatSnapshotAmount(354270000, "en")).toBe("354,270,000");
  });

  it("keeps up to two decimals only when the source value has them", () => {
    expect(formatSnapshotAmount(3200.5, "en")).toBe("3,200.5");
    expect(formatSnapshotAmount(3200.55, "en")).toBe("3,200.55");
  });

  it("preserves a negative Net Exposure sign (never flipped to positive)", () => {
    expect(formatSnapshotAmount(-3210, "en")).toBe("-3,210");
  });

  it("never throws on a non-finite value — falls back to zero", () => {
    expect(formatSnapshotAmount(NaN, "en")).toBe("0");
    expect(formatSnapshotAmount(Infinity, "en")).toBe("0");
  });
});
