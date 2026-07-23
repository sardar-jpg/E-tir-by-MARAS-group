import { useRef, type KeyboardEvent } from "react";
import type { Language } from "../../../types";

/**
 * Accessible currency tab strip for the Financial Snapshot (USD / TRY /
 * IQD, plus any extra currency that has records). Implements the WAI-ARIA
 * Tabs pattern: role=tablist/tab, roving tabindex, and Arrow/Home/End
 * keyboard navigation. Selecting a tab never mixes currencies — it just
 * tells the parent which per-currency bucket to display.
 */
export default function CurrencyTabs({
  currencies,
  selected,
  onSelect,
  idPrefix,
  lang,
}: {
  currencies: string[];
  selected: string;
  onSelect: (currency: string) => void;
  idPrefix: string;
  lang: Language;
}) {
  const isRtl = lang === "ar";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusIndex = (index: number) => {
    const clamped = (index + currencies.length) % currencies.length;
    const currency = currencies[clamped];
    onSelect(currency);
    refs.current[clamped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    // In RTL the visual "next" is to the left, so ArrowLeft/Right are swapped.
    const forward = isRtl ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === forward) { e.preventDefault(); focusIndex(index + 1); }
    else if (e.key === backward) { e.preventDefault(); focusIndex(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusIndex(0); }
    else if (e.key === "End") { e.preventDefault(); focusIndex(currencies.length - 1); }
  };

  return (
    <div
      role="tablist"
      aria-label={lang === "tr" ? "Para birimi" : lang === "ar" ? "العملة" : "Currency"}
      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {currencies.map((currency, index) => {
        const isSelected = currency === selected;
        return (
          <button
            key={currency}
            ref={(el) => { refs.current[index] = el; }}
            role="tab"
            id={`${idPrefix}-tab-${currency}`}
            aria-selected={isSelected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(currency)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`min-w-[52px] rounded-md px-3 py-1.5 text-xs font-black tracking-wide transition-all ${
              isSelected
                ? "bg-white text-slate-900 shadow-sm"
                : "bg-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {currency}
          </button>
        );
      })}
    </div>
  );
}
