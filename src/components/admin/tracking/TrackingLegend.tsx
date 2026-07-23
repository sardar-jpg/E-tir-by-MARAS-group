import { Compass, X } from "lucide-react";
import type { Language } from "../../../types";
import type { TrackingState } from "../../../lib/trackingPositions";

/**
 * Operations Center redesign — compact, HONEST map legend.
 *
 * The previous inline legend described the old status-based marker colours
 * ("En-Route / Arrived / Loading"), which no longer match how markers are
 * coloured. Markers now encode tracking CONFIDENCE (the 4-state honesty
 * model), so the legend documents exactly that — one row per state, using the
 * same colours as stateColors() in TrackingMap — plus a one-line note on
 * clustering. Extracted as its own component so the legend can be reasoned
 * about and reused independently of the 2k-line map container.
 */

const STATE_ROWS: { state: TrackingState; dot: string; labels: Record<Language, string> }[] = [
  {
    state: "live_gps",
    dot: "bg-emerald-500",
    labels: { en: "Live GPS (recent fix)", ar: "تتبع مباشر (حديث)", tr: "Canlı GPS (yeni)" },
  },
  {
    state: "last_reported",
    dot: "bg-amber-500",
    labels: { en: "Last Reported (stale fix)", ar: "آخر موقع مُبلَّغ (قديم)", tr: "Son Bildirilen (eski)" },
  },
  {
    state: "estimated",
    dot: "bg-orange-500",
    labels: { en: "Estimated (from route)", ar: "تقديري (حسب المسار)", tr: "Tahmini (rotadan)" },
  },
  {
    state: "unavailable",
    dot: "bg-slate-500",
    labels: { en: "Location Unavailable (no marker)", ar: "الموقع غير متوفّر (بدون علامة)", tr: "Konum Yok (işaret yok)" },
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
  const title = lang === "ar" ? "دليل التتبع" : lang === "tr" ? "Takip Göstergesi" : "Tracking Legend";
  const clusterNote =
    lang === "ar"
      ? "الأرقام على الخريطة تجمع الشحنات المتقاربة — قرّب للفصل."
      : lang === "tr"
        ? "Sayılı işaretler yakın sevkiyatları gruplar — ayırmak için yakınlaştırın."
        : "Numbered pins group nearby shipments — zoom in to separate.";

  if (!isOpen) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="bg-slate-900/95 backdrop-blur-md border border-slate-800 hover:border-orange-500/40 text-white font-sans text-[9px] font-bold py-1.5 px-2.5 rounded-lg shadow-xl flex items-center gap-1.5 cursor-pointer z-20 group transition-all"
      >
        <Compass className="w-3.5 h-3.5 text-orange-500 group-hover:animate-spin" />
        <span>{lang === "ar" ? "عرض الرموز" : lang === "tr" ? "Göstergeleri Göster" : "Show Legend"}</span>
      </button>
    );
  }

  return (
    <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 w-[220px] rounded-xl shadow-2xl p-3 text-white space-y-2">
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
        <div className="flex items-center gap-1.5 font-sans font-bold text-orange-400 text-[11px]">
          <Compass className="w-3.5 h-3.5 text-orange-500 animate-spin" style={{ animationDuration: "6s" }} />
          <span>{title}</span>
        </div>
        <button
          onClick={() => onToggle(false)}
          className="text-slate-400 hover:text-white transition-all cursor-pointer p-0.5 hover:bg-slate-800/85 rounded"
          title="Collapse"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {STATE_ROWS.map(row => (
          <div key={row.state} className="flex items-center gap-2 text-[10px]">
            <span className={`w-2.5 h-2.5 rounded-full border border-slate-950 shadow-xs shrink-0 ${row.dot}`}></span>
            <span className="text-slate-300 font-sans truncate">{row.labels[lang]}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800/60 pt-1.5 text-[8.5px] text-slate-400 font-sans leading-snug">
        {clusterNote}
      </div>
    </div>
  );
}
