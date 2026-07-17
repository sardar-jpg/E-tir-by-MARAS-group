import { ArrowRight } from "lucide-react";

/**
 * RouteBlock — the ONE canonical "where am I going" element of the
 * Driver App design system. Every screen that shows an origin →
 * destination pair renders this component, so the most important fact
 * in the app always looks identical: big white city names, quiet
 * country captions, one direction arrow that mirrors under RTL.
 *
 * Purely presentational. Two sizes:
 *   hero — display type for the job/offer the driver is acting on
 *   row  — compact single line for lists and summaries
 */
interface RouteBlockProps {
  fromCity?: string | null;
  fromCountry?: string | null;
  toCity?: string | null;
  toCountry?: string | null;
  size?: "hero" | "row";
}

export default function RouteBlock({
  fromCity,
  fromCountry,
  toCity,
  toCountry,
  size = "row",
}: RouteBlockProps) {
  if (size === "hero") {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 text-start">
          <p className="text-[26px] leading-8 font-extrabold text-white tracking-tight truncate">{fromCity || "—"}</p>
          {fromCountry && <p className="text-xs text-slate-500 truncate mt-0.5">{fromCountry}</p>}
        </div>
        <div className="shrink-0 w-9 h-9 rounded-full bg-slate-950 flex items-center justify-center">
          <ArrowRight className="w-4.5 h-4.5 text-orange-500 rtl:rotate-180" />
        </div>
        <div className="flex-1 min-w-0 text-end">
          <p className="text-[26px] leading-8 font-extrabold text-white tracking-tight truncate">{toCity || "—"}</p>
          {toCountry && <p className="text-xs text-slate-500 truncate mt-0.5">{toCountry}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="font-bold text-slate-200 truncate">{fromCity || "—"}</span>
      <ArrowRight className="w-4 h-4 text-orange-500 shrink-0 rtl:rotate-180" />
      <span className="font-bold text-slate-200 truncate">{toCity || "—"}</span>
    </div>
  );
}
