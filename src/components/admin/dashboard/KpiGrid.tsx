import type { ReactNode } from "react";

/**
 * Responsive KPI row, sized off the grid's own available width (CSS
 * container queries) rather than the viewport's — the sidebar eats real
 * width out of the content column, so a viewport breakpoint like
 * `xl:grid-cols-6` forced 6 cards into one row at 1440px even though the
 * actual content column there is only ~1120px wide, which is what caused
 * every KPI title to truncate (verified in PR #155 QA). Container queries
 * react to the box the grid is actually laid out in, so this stays
 * correct regardless of sidebar collapsed/expanded state or how wide the
 * surrounding page chrome is.
 *
 * Two columns by default, three once the grid has room to breathe (covers
 * tablets and normal desktop widths, sidebar expanded or not), six only
 * once the available width can comfortably fit all six without cramming.
 * Equal-height cards (each KpiCard is h-full; CSS Grid rows already
 * equalize height across cards in the same row).
 */
export default function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @7xl:grid-cols-6">
        {children}
      </div>
    </div>
  );
}
