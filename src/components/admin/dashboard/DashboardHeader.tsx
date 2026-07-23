import { Calendar, RefreshCw } from "lucide-react";
import type { Language } from "../../../types";

export type DashboardRange = "7d" | "30d" | "90d" | "all";

/** Start-of-window in epoch ms for a range (used to filter Recent Activity). */
export function rangeStartMs(range: DashboardRange, nowMs: number): number {
  const day = 86_400_000;
  switch (range) {
    case "7d": return nowMs - 7 * day;
    case "30d": return nowMs - 30 * day;
    case "90d": return nowMs - 90 * day;
    case "all": return 0;
  }
}

const S: Record<string, Record<Language, string>> = {
  title: { en: "Dashboard Overview", tr: "Panel Genel Bakışı", ar: "نظرة عامة على اللوحة" },
  subtitle: {
    en: "Real-time overview of operations, shipments, and performance",
    tr: "Operasyonlar, sevkiyatlar ve performansın gerçek zamanlı genel görünümü",
    ar: "نظرة فورية على العمليات والشحنات والأداء",
  },
  lastSync: { en: "Last sync", tr: "Son eşitleme", ar: "آخر مزامنة" },
  justNow: { en: "just now", tr: "az önce", ar: "الآن" },
  range: { en: "Date range", tr: "Tarih aralığı", ar: "النطاق الزمني" },
  r7: { en: "Last 7 days", tr: "Son 7 gün", ar: "آخر 7 أيام" },
  r30: { en: "Last 30 days", tr: "Son 30 gün", ar: "آخر 30 يومًا" },
  r90: { en: "Last 90 days", tr: "Son 90 gün", ar: "آخر 90 يومًا" },
  rAll: { en: "All time", tr: "Tüm zamanlar", ar: "كل الوقت" },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

/**
 * Dashboard page header: title, subtitle, a functional date-range selector
 * (windows the Recent Activity feed), and a live "last sync" indicator.
 *
 * It deliberately does NOT duplicate the global app bar's language switch,
 * notifications, user menu, or Create Shipment action — those already live
 * in the persistent header, so there is never a second Create Shipment
 * primary action on this screen.
 */
export default function DashboardHeader({
  lang,
  lastSyncedAt,
  currentTime,
  range,
  onRangeChange,
}: {
  lang: Language;
  lastSyncedAt: Date | null;
  currentTime: Date;
  range: DashboardRange;
  onRangeChange: (r: DashboardRange) => void;
}) {
  const locale = lang === "ar" ? "ar-EG" : lang === "tr" ? "tr-TR" : "en-US";
  const syncLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : L("justNow", lang);
  // currentTime is referenced so the indicator re-renders with the app clock.
  void currentTime;

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{L("title", lang)}</h1>
        <p className="mt-0.5 text-xs font-medium text-slate-500">{L("subtitle", lang)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <label className="sr-only" htmlFor="dash-range">{L("range", lang)}</label>
          <select
            id="dash-range"
            value={range}
            onChange={(e) => onRangeChange(e.target.value as DashboardRange)}
            className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none"
          >
            <option value="7d">{L("r7", lang)}</option>
            <option value="30d">{L("r30", lang)}</option>
            <option value="90d">{L("r90", lang)}</option>
            <option value="all">{L("rAll", lang)}</option>
          </select>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <RefreshCw className="h-3 w-3 text-slate-400" />
          {L("lastSync", lang)}: {syncLabel}
        </span>
      </div>
    </header>
  );
}
