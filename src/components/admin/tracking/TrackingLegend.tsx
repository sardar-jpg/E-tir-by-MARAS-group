import { ChevronDown, ChevronUp } from "lucide-react";
import type { Language } from "../../../types";
import type { TrackingState } from "../../../lib/trackingPositions";

/**
 * Operations Center — compact, HONEST floating map legend (light surface).
 *
 * Documents exactly the 4-state tracking-confidence model the markers encode
 * (same colours as trackingMarkerStyles): Live GPS (green), Last Reported
 * (amber), Estimated Position (blue), Location Unavailable (slate, no
 * marker). Collapsed by default; expands to a small white card. Localized
 * en/tr/ar — never a hardcoded English-only panel.
 */

const STATE_ROWS: {
  state: TrackingState;
  dot: string;
  labels: Record<Language, string>;
  sub: Record<Language, string>;
}[] = [
  {
    state: "live_gps",
    dot: "bg-emerald-500",
    labels: { en: "Live GPS", ar: "تتبع مباشر", tr: "Canlı GPS" },
    sub: { en: "Real-time position", ar: "موقع لحظي حقيقي", tr: "Gerçek zamanlı konum" },
  },
  {
    state: "last_reported",
    dot: "bg-amber-500",
    labels: { en: "Last Reported", ar: "آخر موقع مُبلَّغ", tr: "Son Bildirilen" },
    sub: { en: "Stale position", ar: "موقع قديم", tr: "Eski konum" },
  },
  {
    state: "estimated",
    dot: "bg-sky-500",
    labels: { en: "Estimated Position", ar: "موقع تقديري", tr: "Tahmini Konum" },
    sub: { en: "Based on known location", ar: "استناداً إلى موقع معروف", tr: "Bilinen konuma göre" },
  },
  {
    state: "unavailable",
    dot: "bg-slate-400",
    labels: { en: "Location Unavailable", ar: "الموقع غير متوفّر", tr: "Konum Yok" },
    sub: { en: "No position available", ar: "لا يوجد موقع متاح", tr: "Konum mevcut değil" },
  },
];

export default function TrackingLegend({
  lang,
  isOpen,
  onToggle,
}: {
  lang: Language;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}) {
  const title = lang === "ar" ? "دليل الخريطة" : lang === "tr" ? "Harita Göstergesi" : "Map Legend";

  if (!isOpen) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="bg-white/95 backdrop-blur-sm border border-slate-200 hover:border-slate-300 text-slate-700 font-sans text-[11px] font-bold py-1.5 px-3 rounded-lg shadow-lg flex items-center gap-1.5 cursor-pointer z-20 transition-all"
      >
        <span>{title}</span>
        <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 w-[210px] rounded-xl shadow-xl p-3 text-slate-800 space-y-2">
      <button
        onClick={() => onToggle(false)}
        className="w-full flex items-center justify-between border-b border-slate-100 pb-1.5 cursor-pointer bg-transparent border-x-0 border-t-0"
        title={lang === "ar" ? "طي" : lang === "tr" ? "Daralt" : "Collapse"}
      >
        <span className="font-sans font-bold text-[12px] text-slate-800">{title}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      <div className="space-y-2">
        {STATE_ROWS.map(row => (
          <div key={row.state} className="flex items-start gap-2">
            <span className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${row.dot}`}></span>
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] font-bold text-slate-700 truncate">{row.labels[lang]}</p>
              <p className="text-[10px] text-slate-400 truncate">{row.sub[lang]}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
