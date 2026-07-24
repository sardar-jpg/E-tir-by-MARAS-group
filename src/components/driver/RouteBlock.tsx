import { ArrowRight } from "lucide-react";

/**
 * RouteBlock — the ONE canonical "where am I going" element of the
 * Driver App design system. Every list/summary that shows an origin →
 * destination pair renders this component, so the most important fact
 * in the app always looks identical: bold city names, quiet country
 * captions, one direction arrow that mirrors under RTL.
 *
 * Purely presentational. Two sizes:
 *   hero — display type for the job/offer the driver is acting on;
 *          wraps gracefully instead of truncating city names
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
          <p className="text-[24px] leading-8 font-extrabold text-slate-900 tracking-tight break-words">{fromCity || "—"}</p>
          {fromCountry && <p className="text-xs text-slate-400 font-semibold mt-0.5">{fromCountry}</p>}
        </div>
        <div className="shrink-0 w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center">
          <ArrowRight className="w-4.5 h-4.5 text-blue-600 rtl:rotate-180" />
        </div>
        <div className="flex-1 min-w-0 text-end">
          <p className="text-[24px] leading-8 font-extrabold text-slate-900 tracking-tight break-words">{toCity || "—"}</p>
          {toCountry && <p className="text-xs text-slate-400 font-semibold mt-0.5">{toCountry}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="font-bold text-slate-700 truncate">{fromCity || "—"}</span>
      <ArrowRight className="w-4 h-4 text-blue-600 shrink-0 rtl:rotate-180" />
      <span className="font-bold text-slate-700 truncate">{toCity || "—"}</span>
    </div>
  );
}
