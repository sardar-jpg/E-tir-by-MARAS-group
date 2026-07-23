import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_CURRENCIES,
  SNAPSHOT_METRIC_ORDER,
  snapshotCurrencyTabs,
  currencySnapshot,
  netPositionKind,
  netPositionDisplayAmount,
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
    averageProfitPerShipment: null,
    highestProfitShipmentThisMonth: null,
    topCustomerThisMonth: null,
    ...over,
  }) as CurrencyFinanceOverview;

const overview = (currencies: CurrencyFinanceOverview[]): ExecutiveFinanceOverview =>
  ({ currencies, statementCount: 0, deliveredWithStatementCount: 0 });

describe("financialSnapshot — fixed USD / TRY / IQD tabs", () => {
  it("(1) defaults to USD (the first tab)", () => {
    expect(snapshotCurrencyTabs()[0]).toBe("USD");
  });

  it("(2) shows exactly USD, TRY, IQD in that order", () => {
    expect([...SNAPSHOT_CURRENCIES]).toEqual(["USD", "TRY", "IQD"]);
    expect(snapshotCurrencyTabs()).toEqual(["USD", "TRY", "IQD"]);
  });

  it("(3) never displays EUR (or any currency beyond the fixed three), even when EUR has records", () => {
    // The tab set is fixed and ignores the overview entirely.
    expect(snapshotCurrencyTabs()).not.toContain("EUR");
    const ovWithEur = overview([block("EUR", { outstandingReceivables: 9999 }), block("USD")]);
    void ovWithEur; // present in data, still never a tab on this card
    expect(snapshotCurrencyTabs()).toEqual(["USD", "TRY", "IQD"]);
  });

  it("(4) keeps IQD visible with clean zeros when it has no records", () => {
    expect(snapshotCurrencyTabs()).toContain("IQD");
    const iqd = currencySnapshot(overview([block("USD", { outstandingReceivables: 100 })]), "IQD");
    expect(iqd.hasData).toBe(false);
    expect(iqd.metrics).toEqual({ receivables: 0, vendorPayables: 0, openShipmentValue: 0, netPosition: 0 });
  });

  it("renders the four rows in the reference order", () => {
    expect([...SNAPSHOT_METRIC_ORDER]).toEqual(["receivables", "vendorPayables", "openShipmentValue", "netPosition"]);
  });
});

describe("financialSnapshot — per-currency rows (never mixed, never converted)", () => {
  const ov = overview([
    block("USD", { outstandingReceivables: 3200, vendorPayables: 6410, openShipmentsValue: 247254 }),
    block("TRY", { outstandingReceivables: 85420, vendorPayables: 1000, openShipmentsValue: 500000 }),
    block("IQD", { outstandingReceivables: 900000000, vendorPayables: 354270000, openShipmentsValue: 12000000000 }),
  ]);

  it("(5) switching currency reads a different bucket into the SAME rows", () => {
    expect(currencySnapshot(ov, "USD").metrics.receivables).toBe(3200);
    expect(currencySnapshot(ov, "TRY").metrics.receivables).toBe(85420);
    expect(currencySnapshot(ov, "IQD").metrics.receivables).toBe(900000000);
  });

  it("(6) never combines currencies — each tab is independent", () => {
    const usd = currencySnapshot(ov, "USD");
    const tryS = currencySnapshot(ov, "TRY");
    expect(usd.metrics.receivables).not.toBe(tryS.metrics.receivables);
    expect(usd.metrics.receivables + tryS.metrics.receivables).not.toBe(usd.metrics.receivables); // no summing
  });

  it("(7) never converts — values are the raw per-currency figures", () => {
    const usd = currencySnapshot(ov, "USD");
    expect(usd.metrics.receivables).toBe(3200);
    expect(usd.metrics.vendorPayables).toBe(6410);
    expect(usd.metrics.openShipmentValue).toBe(247254);
  });

  it("(15) the underlying signed netPosition = receivables − vendorPayables (per currency)", () => {
    expect(currencySnapshot(ov, "USD").metrics.netPosition).toBe(3200 - 6410); // -3210
    expect(currencySnapshot(ov, "TRY").metrics.netPosition).toBe(85420 - 1000); // 84420
    expect(currencySnapshot(ov, "IQD").metrics.netPosition).toBe(900000000 - 354270000);
  });
});

describe("financialSnapshot — Funding Gap / Net Surplus / Balanced", () => {
  it("(8) payables greater than receivables → Funding Gap", () => {
    const signed = 3200 - 6410; // -3210
    expect(netPositionKind(signed)).toBe("funding_gap");
  });

  it("(9) the Funding Gap amount is displayed POSITIVE (the amount to cover)", () => {
    expect(netPositionDisplayAmount(3200 - 6410)).toBe(3210);
    expect(formatSnapshotAmount(netPositionDisplayAmount(3200 - 6410), "en")).toBe("3,210");
  });

  it("(10) receivables greater than payables → Net Surplus, positive amount", () => {
    const signed = 85420 - 1000; // 84420
    expect(netPositionKind(signed)).toBe("net_surplus");
    expect(netPositionDisplayAmount(signed)).toBe(84420);
  });

  it("(11) equal receivables and payables → Balanced, amount 0", () => {
    expect(netPositionKind(0)).toBe("balanced");
    expect(netPositionDisplayAmount(0)).toBe(0);
    // sub-cent float noise is treated as balanced too
    expect(netPositionKind(0.004)).toBe("balanced");
    expect(netPositionKind(-0.004)).toBe("balanced");
  });
});

describe("financialSnapshot — locale-safe amount formatting", () => {
  it("groups thousands and omits unnecessary decimals", () => {
    expect(formatSnapshotAmount(247254, "en")).toBe("247,254");
    expect(formatSnapshotAmount(0, "en")).toBe("0");
  });

  it("(12) formats very large IQD amounts without exponent or clipping", () => {
    expect(formatSnapshotAmount(354270000, "en")).toBe("354,270,000");
    expect(formatSnapshotAmount(12000000000, "en")).toBe("12,000,000,000");
  });

  it("keeps up to two decimals only when the source value has them", () => {
    expect(formatSnapshotAmount(3200.5, "en")).toBe("3,200.5");
    expect(formatSnapshotAmount(3200.55, "en")).toBe("3,200.55");
  });

  it("never throws on a non-finite value — falls back to zero", () => {
    expect(formatSnapshotAmount(NaN, "en")).toBe("0");
    expect(formatSnapshotAmount(Infinity, "en")).toBe("0");
  });
});
