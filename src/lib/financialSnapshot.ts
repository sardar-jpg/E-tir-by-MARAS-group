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
 * The Dashboard Overview Financial Snapshot shows EXACTLY these three
 * currency tabs, in this fixed order — never more. EUR (and any other
 * currency) may exist elsewhere in the accounting module, but this compact
 * card is intentionally limited to USD / TRY / IQD. IQD is always shown,
 * even when all its values are zero.
 */
export const SNAPSHOT_CURRENCIES = ["USD", "TRY", "IQD"] as const;
export type SnapshotCurrency = (typeof SNAPSHOT_CURRENCIES)[number];

export type SnapshotMetricKey = "receivables" | "vendorPayables" | "openShipmentValue" | "netPosition";

/** The four rows, in display order (matches the reference layout). */
export const SNAPSHOT_METRIC_ORDER: readonly SnapshotMetricKey[] = [
  "receivables",
  "vendorPayables",
  "openShipmentValue",
  "netPosition",
];

export interface CurrencySnapshot {
  currency: string;
  /** True when this currency actually has accounting records; false = an all-zero tab. */
  hasData: boolean;
  metrics: Record<SnapshotMetricKey, number>;
}

/**
 * The fixed list of currency tabs the card renders: exactly USD, TRY, IQD.
 * The overview argument is intentionally ignored — the card never grows or
 * shrinks its tab set based on which currencies happen to have data, so IQD
 * is never hidden at zero and EUR is never appended.
 */
export function snapshotCurrencyTabs(): SnapshotCurrency[] {
  return [...SNAPSHOT_CURRENCIES];
}

/**
 * Signed net position for a currency = outstanding customer receivables −
 * vendor payables (same currency only, never mixed or converted). Positive
 * = MARAS is net owed (surplus); negative = MARAS owes more than it is owed
 * (a funding gap). This signed value is the source of truth for accounting;
 * the card derives a positive, human-readable Funding Gap / Net Surplus /
 * Balanced figure from it (see netPositionKind / netPositionDisplayAmount).
 */
function signedNetPosition(block: CurrencyFinanceOverview): number {
  return block.outstandingReceivables - block.vendorPayables;
}

function metricsFromBlock(block: CurrencyFinanceOverview): Record<SnapshotMetricKey, number> {
  return {
    receivables: block.outstandingReceivables,
    vendorPayables: block.vendorPayables,
    openShipmentValue: block.openShipmentsValue,
    netPosition: signedNetPosition(block),
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
      metrics: { receivables: 0, vendorPayables: 0, openShipmentValue: 0, netPosition: 0 },
    };
  }
  return { currency, hasData: true, metrics: metricsFromBlock(block) };
}

export type NetPositionKind = "funding_gap" | "net_surplus" | "balanced";

// Sub-cent noise never flips a currency between gap/surplus; |Δ| below this
// reads as Balanced.
const BALANCED_EPSILON = 0.005;

/** Classify a signed net position into the user-facing outcome. */
export function netPositionKind(signed: number): NetPositionKind {
  if (!Number.isFinite(signed) || Math.abs(signed) < BALANCED_EPSILON) return "balanced";
  return signed < 0 ? "funding_gap" : "net_surplus";
}

/**
 * The POSITIVE amount shown to the user: the size of the funding gap
 * (payables − receivables) or the surplus (receivables − payables), and 0
 * when balanced. The signed value stays intact for accounting; only the
 * display is made positive.
 */
export function netPositionDisplayAmount(signed: number): number {
  return netPositionKind(signed) === "balanced" ? 0 : Math.abs(signed);
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
