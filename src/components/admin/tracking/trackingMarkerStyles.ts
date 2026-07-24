import type { TrackingState } from "../../../lib/trackingPositions";

/**
 * Marker colour tokens per honesty state — one source of truth shared by the
 * Vector Radar, the Google Map markers, and the Google cluster layer so the
 * same tracking state always reads the same way. Palette follows the approved
 * Operations Center design:
 *   green = Live GPS, amber = Last Reported, blue = Estimated Position,
 *   slate = Location Unavailable. Orange is reserved for SELECTION and
 *   primary actions, so an estimated marker can never be confused with the
 *   selected one.
 */
export interface TrackingMarkerColors {
  ring: string;
  stroke: string;
  bg: string;
  text: string;
  chip: string;
  /** Light-surface tone for list chips / KPI cards. */
  lightDot: string;
  lightText: string;
  lightChip: string;
}

export function stateColors(state: TrackingState): TrackingMarkerColors {
  switch (state) {
    case "live_gps":
      return {
        ring: "rgba(34,197,94,0.18)", stroke: "#22c55e",
        bg: "bg-emerald-600 border-white", text: "text-emerald-500", chip: "● GPS",
        lightDot: "bg-emerald-500", lightText: "text-emerald-700", lightChip: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "last_reported":
      return {
        ring: "rgba(245,158,11,0.16)", stroke: "#f59e0b",
        bg: "bg-amber-500 border-white", text: "text-amber-500", chip: "◐ LAST",
        lightDot: "bg-amber-500", lightText: "text-amber-700", lightChip: "bg-amber-50 text-amber-700 border-amber-200",
      };
    case "estimated":
      return {
        ring: "rgba(59,130,246,0.16)", stroke: "#3b82f6",
        bg: "bg-sky-600 border-white", text: "text-sky-500", chip: "◌ EST",
        lightDot: "bg-sky-500", lightText: "text-sky-700", lightChip: "bg-sky-50 text-sky-700 border-sky-200",
      };
    default:
      return {
        ring: "rgba(100,116,139,0.12)", stroke: "#64748b",
        bg: "bg-slate-500 border-white", text: "text-slate-400", chip: "◯",
        lightDot: "bg-slate-400", lightText: "text-slate-500", lightChip: "bg-slate-100 text-slate-500 border-slate-200",
      };
  }
}
