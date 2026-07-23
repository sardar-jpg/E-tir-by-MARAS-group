/**
 * financialSnapshot.ts — pure view-model for the Dashboard's Financial
 * Snapshot card (one compact card, currency-tabbed).
 *
 * It reshapes the REAL accounting figures already produced by
 * executiveFinance.ts (`CurrencyFinanceOverview`, served verbatim by
 * GET /api/admin/dashboard/financial) into the four rows shown in the
 * card, for ONE selected currency at a time.
 *
 * Currency discipline is absolute here, exactly as in executiveFinance.ts:
 * every value belongs to a single currency bucket. Nothing is ever summed
 * or subtracted across currencies, and there is no FX conversion. Selecting
 * a different tab simply reads a different per-currency bucket — it never
 * combines them.
 */
import type { CurrencyFinanceOverview, ExecutiveFinanceOverview } from "./executiveFinance";
import type { Language } from "../types";

/**
 * The three currency tabs the card ALWAYS offers, in this fixed order —
 * even when a currency currently has no records (an all-zero IQD tab is
 * still shown; it is never hidden just because its values are zero).
 */
export const REQUIRED_SNAPSHOT_CURRENCIES = ["USD", "TRY", "IQD"] as const;

export type SnapshotMetricKey = "receivables" | "vendorPayables" | "openShipmentValue" | "netExposure";

/** The four rows, in display order (matches the reference layout). */
export const SNAPSHOT_METRIC_ORDER: readonly SnapshotMetricKey[] = [
  "receivables",
  "vendorPayables",
  "openShipmentValue",
  "netExposure",
];

export interface CurrencySnapshot {
  currency: string;
  /** True when this currency actually has accounting records; false = an all-zero tab. */
  hasData: boolean;
  metrics: Record<SnapshotMetricKey, number>;
}

/**
 * The ordered list of currency tabs to render: the three required
 * currencies first (always, even at zero), then any OTHER currency that
 * actually has records (e.g. EUR) appended — so real accounting activity
 * is never hidden, while the required three are never dropped.
 */
export function snapshotCurrencyTabs(overview: ExecutiveFinanceOverview | null | undefined): string[] {
  const tabs: string[] = [...REQUIRED_SNAPSHOT_CURRENCIES];
  for (const block of overview?.currencies ?? []) {
    if (!tabs.includes(block.currency)) tabs.push(block.currency);
  }
  return tabs;
}

function metricsFromBlock(block: CurrencyFinanceOverview): Record<SnapshotMetricKey, number> {
  return {
    receivables: block.outstandingReceivables,
    vendorPayables: block.vendorPayables,
    openShipmentValue: block.openShipmentsValue,
    netExposure: block.netExposure,
  };
}

/**
 * The snapshot for ONE currency. When the overview has a bucket for that
 * currency, its real figures are used; otherwise every row is a clean zero
 * with hasData=false (a genuinely empty tab, never a fabricated value).
 */
export function currencySnapshot(
  overview: ExecutiveFinanceOverview | null | undefined,
  currency: string
): CurrencySnapshot {
  const block = overview?.currencies?.find((c) => c.currency === currency);
  if (!block) {
    return {
      currency,
      hasData: false,
      metrics: { receivables: 0, vendorPayables: 0, openShipmentValue: 0, netExposure: 0 },
    };
  }
  return { currency, hasData: true, metrics: metricsFromBlock(block) };
}

const LOCALE: Record<Language, string> = { en: "en-US", tr: "tr-TR", ar: "ar-EG" };

/**
 * Locale-safe amount formatting via Intl.NumberFormat. The currency CODE
 * is shown separately in the row (never mixed into the number), so this
 * formats the bare grouped number — no currency symbol. Up to two decimals
 * are kept only when the source value has them (e.g. 3,200.50); whole
 * amounts render without trailing zeros (247,254 · 354,270,000).
 */
export function formatSnapshotAmount(value: number, lang: Language = "en"): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(LOCALE[lang] || "en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(safe);
}
