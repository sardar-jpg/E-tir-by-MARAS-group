/**
 * trackingMapStatus.ts
 *
 * feature/admin-mobile-ui correction pass
 *
 * Pure, testable single source of truth for whether the Tracking page is
 * allowed to say "Live"/"Active" about Google Maps GPS tracking. Before
 * this, TrackingMap.tsx's header unconditionally claimed "Live Google
 * Maps GIS Tracking Active" whenever google_map mode was selected — even
 * with no configured API key or an auth failure, directly contradicting
 * the "Map service not configured" / auth-error fallback panel shown in
 * the very same view. Extracted so the honesty rule can be unit tested
 * independent of React/DOM, and so there is exactly one place deciding
 * it — reused by both the desktop and mobile headers in TrackingMap.tsx.
 */

export type MapViewMode = "vector" | "google_map";

export interface TrackingMapRuntimeState {
  mapViewMode: MapViewMode;
  hasValidMapsKey: boolean;
  mapsAuthError: boolean;
}

/**
 * True only when Google Maps is the active view mode AND a real key is
 * configured AND no auth failure has occurred. Never true for vector
 * mode (that's an always-available simulated radar, not Google Maps).
 */
export function isGoogleMapsLive(state: TrackingMapRuntimeState): boolean {
  return state.mapViewMode === "google_map" && state.hasValidMapsKey && !state.mapsAuthError;
}

export type TrackingStatus = "vector" | "live" | "not_configured" | "demo";

/**
 * Resolves which honest status the UI should display. Callers map this
 * to their own localized strings — this function only ever picks
 * between the 4 real states, never fabricates a 5th "in between" state.
 */
export function resolveTrackingStatus(state: TrackingMapRuntimeState): TrackingStatus {
  if (state.mapViewMode === "vector") return "vector";
  if (isGoogleMapsLive(state)) return "live";
  if (!state.hasValidMapsKey) return "not_configured";
  return "demo";
}
