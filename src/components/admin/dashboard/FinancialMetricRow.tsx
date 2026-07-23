import type { ComponentType } from "react";

/**
 * One row of the Financial Snapshot: a semantic icon, the metric label,
 * and the amount right-aligned (logical end) with its currency code
 * beneath. The currency code is ALWAYS shown next to the number so a
 * figure can never be read without its currency — currencies are never
 * mixed or converted anywhere in this card.
 */
export default function FinancialMetricRow({
  icon: Icon,
  iconClass,
  label,
  amount,
  currency,
}: {
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  amount: string;
  currency: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-600 truncate">{label}</span>
      <span className="text-end shrink-0">
        <span className="block text-base font-black tabular-nums text-slate-900">{amount}</span>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{currency}</span>
      </span>
    </div>
  );
}
