import type { ComponentType } from "react";
import { Info } from "lucide-react";

/**
 * One row of the Financial Snapshot: a semantic icon, the metric label,
 * and the amount right-aligned (logical end) with its currency code
 * beneath. The currency code is ALWAYS shown next to the number so a
 * figure can never be read without its currency — currencies are never
 * mixed or converted anywhere in this card.
 *
 * `valueClass` colours the amount for the semantic net-position row
 * (Funding Gap = warning, Net Surplus = positive). `tooltip` renders an
 * accessible info affordance (keyboard-focusable, screen-reader labelled)
 * explaining the calculation.
 */
export default function FinancialMetricRow({
  icon: Icon,
  iconClass,
  label,
  amount,
  currency,
  valueClass = "text-slate-900",
  tooltip,
}: {
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  amount: string;
  currency: string;
  valueClass?: string;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-slate-600">{label}</span>
        {tooltip && (
          <button
            type="button"
            title={tooltip}
            aria-label={tooltip}
            className="shrink-0 rounded-full p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      <span className="text-end shrink-0">
        <span className={`block text-base font-black tabular-nums ${valueClass}`}>{amount}</span>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{currency}</span>
      </span>
    </div>
  );
}
