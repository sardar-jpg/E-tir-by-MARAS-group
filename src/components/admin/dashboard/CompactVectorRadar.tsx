import { MapPin } from "lucide-react";
import type { Language } from "../../../types";

export interface RadarPoint {
  id: string;
  lat: number;
  lng: number;
  status: string;
  label: string;
  /** True when this position came from the known-city fallback rather than a live GPS ping. */
  estimated: boolean;
}

const S: Record<string, Record<Language, string>> = {
  gridLabel: { en: "Turkey–Iraq corridor", tr: "Türkiye–Irak koridoru", ar: "ممر تركيا–العراق" },
  estimatedBadge: { en: "Estimated positions", tr: "Tahmini konumlar", ar: "مواقع تقديرية" },
  estimatedNote: {
    en: "Positions estimated from destination city — not live GPS.",
    tr: "Konumlar hedef şehirden tahmin edilmiştir — canlı GPS değildir.",
    ar: "المواقع مقدَّرة من مدينة الوجهة — وليست GPS مباشرًا.",
  },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

// Same bounding box as the corridor LiveOperationsMap/TrackingMap already
// plot (Istanbul in the north-west down to Basra in the south-east), just
// used here to project lat/lng onto a simple 0–100 percentage grid instead
// of Google's tiles. This is a schematic, not a claim of cartographic
// accuracy — see the "estimated positions" disclosure below.
const BOUNDS = { minLat: 29.8, maxLat: 41.6, minLng: 28.3, maxLng: 48.3 };

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100;
  const y = 100 - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(94, Math.max(6, y)) };
}

function markerColor(status: string): string {
  if (status === "In Transit") return "#3b82f6";
  if (status === "Customs Clearance") return "#f43f5e";
  if (status === "Assigned") return "#10b981";
  if (status === "New" || status === "Waiting for Driver Quotes") return "#f59e0b";
  return "#94a3b8";
}

const GRID_LINES = [20, 40, 60, 80];

/**
 * Compact, no-API-key fallback for the Dashboard's Live Operations Map
 * card — added for the PR #155 QA correction pass. When no Google Maps
 * key is configured (or Google Maps fails to load), this renders the
 * same real shipment positions (live GPS when available, else the known
 * destination-city fallback — computed by the parent, unchanged) as
 * simple dots on a schematic corridor grid instead of a large empty
 * card. Deliberately does NOT draw connecting route lines between
 * markers (that would imply a real path this data doesn't have) and
 * always discloses when a position is estimated rather than live GPS.
 * This is a lightweight sibling to the full GPS Tracking page's "Vector
 * Radar" — not a copy of it — kept intentionally small since the card
 * only needs to show "roughly where things are," not full interactive
 * tracking (pan/zoom/search live on the full page via "View all on Map").
 */
export default function CompactVectorRadar({ points, lang }: { points: RadarPoint[]; lang: Language }) {
  const hasEstimated = points.some((p) => p.estimated);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <div className="flex items-center justify-between px-3 pt-2.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {L("gridLabel", lang)}
        </span>
        {hasEstimated && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400" title={L("estimatedNote", lang)}>
            {L("estimatedBadge", lang)}
          </span>
        )}
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {GRID_LINES.map((v) => (
          <line key={`v${v}`} x1={v} y1={0} x2={v} y2={100} stroke="#1e293b" strokeWidth="0.25" />
        ))}
        {GRID_LINES.map((v) => (
          <line key={`h${v}`} x1={0} y1={v} x2={100} y2={v} stroke="#1e293b" strokeWidth="0.25" />
        ))}
        {points.map((p) => {
          const { x, y } = project(p.lat, p.lng);
          const color = markerColor(p.status);
          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r="2.6" fill={color} fillOpacity="0.25" />
              <circle cx={x} cy={y} r="1.4" fill={color} stroke="#0f172a" strokeWidth="0.4" />
              <title>{p.estimated ? `${p.label} (${L("estimatedBadge", lang)})` : p.label}</title>
            </g>
          );
        })}
      </svg>

      {hasEstimated && (
        <p className="absolute inset-x-0 bottom-0 px-3 pb-2 text-center text-[9px] font-medium leading-snug text-slate-500">
          {L("estimatedNote", lang)}
        </p>
      )}
    </div>
  );
}
