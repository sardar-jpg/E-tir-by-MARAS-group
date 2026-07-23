import type { TrackingState } from "../../../lib/trackingPositions";

/**
 * Marker colour tokens per honesty state — one source of truth shared by the
 * Vector Radar, the Google Map markers, and the Google cluster layer so the
 * same tracking state always reads the same way:
 *   green = live GPS, amber = last reported, orange = estimated, slate = other.
 *
 * Extracted from TrackingMap so the extracted marker components can import it
 * instead of re-deriving colours (which would risk drift between the two maps).
 */
export interface TrackingMarkerColors {
  ring: string;
  stroke: string;
  bg: string;
  text: string;
  chip: string;
}

export function stateColors(state: TrackingState): TrackingMarkerColors {
  switch (state) {
    case "live_gps":
      return { ring: "rgba(34,197,94,0.18)", stroke: "#22c55e", bg: "bg-emerald-700 border-emerald-400", text: "text-emerald-400", chip: "● GPS" };
    case "last_reported":
      return { ring: "rgba(245,158,11,0.16)", stroke: "#f59e0b", bg: "bg-amber-700 border-amber-400", text: "text-amber-400", chip: "◐ LAST" };
    case "estimated":
      return { ring: "rgba(249,115,22,0.12)", stroke: "rgba(249,115,22,0.4)", bg: "bg-slate-900 border-orange-500", text: "text-orange-400", chip: "◌ EST" };
    default:
      return { ring: "rgba(100,116,139,0.12)", stroke: "#475569", bg: "bg-slate-800 border-slate-600", text: "text-slate-500", chip: "◯" };
  }
}
