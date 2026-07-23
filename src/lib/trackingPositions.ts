/**
 * trackingPositions.ts
 *
 * Operations Center redesign — pure, testable "where do we honestly place
 * this shipment on the map, and how confident are we about it" logic.
 *
 * The legacy TrackingMap.tsx quietly conflated four very different
 * situations into one moving truck marker:
 *   1. a real, recent driver GPS fix,
 *   2. a real but stale driver GPS fix,
 *   3. no GPS at all — a guessed position interpolated along the highway
 *      and animated every 4 seconds by a ticker (pure fiction), and
 *   4. an unknown city that silently fell back to Istanbul / Baghdad.
 *
 * Cases 3 and 4 make the map lie: an operator cannot tell a genuine live
 * location from a fabricated one. This module replaces that with a single
 * honest 4-state model so the UI can label every marker truthfully and
 * never invent motion or a location it does not have.
 *
 * It is deliberately free of React, DOM, Google Maps and network access so
 * the honesty rules can be unit tested in isolation. TrackingMap and its
 * child map components consume the result; they never re-derive placement.
 */

import type { Driver, Shipment } from "../types";
import { getGpsFreshness, type GpsFreshness } from "./gpsFreshness";

/**
 * The only four things the map is ever allowed to say about a shipment's
 * position. There is intentionally no "in between" or "simulated moving"
 * state — if we don't have a real fix we say so.
 *
 * - live_gps       real driver GPS fix, received recently (fresh).
 * - last_reported  real driver GPS fix, but older than the stale
 *                  threshold (or with no timestamp at all). Still a real
 *                  coordinate — just not necessarily current.
 * - estimated      NO driver GPS. Anchored to a known origin/destination
 *                  city so the operator has a rough area, clearly flagged
 *                  as an estimate. Never interpolated, never animated.
 * - unavailable    NO driver GPS and no recognizable city to anchor to.
 *                  We place no marker and never fall back to a default
 *                  city — the shipment stays in the list, honestly labeled.
 */
export type TrackingState = "live_gps" | "last_reported" | "estimated" | "unavailable";

export interface GeoCoord {
  lat: number;
  lng: number;
}

/**
 * How the resolved lat/lng was obtained. Lets the UI phrase tooltips
 * correctly ("driver GPS" vs "estimated near origin/destination").
 */
export type TrackingPositionSource =
  | "driver_gps"
  | "origin_city"
  | "destination_city"
  | "none";

export interface TrackingPosition {
  state: TrackingState;
  /** Real geographic coordinate, or null when state is "unavailable". */
  lat: number | null;
  lng: number | null;
  /** True ONLY for live_gps / last_reported — i.e. a genuine driver fix. */
  isReal: boolean;
  source: TrackingPositionSource;
  /**
   * Normalized key of the city used to anchor an "estimated" position
   * (e.g. "baghdad"), for a tooltip like "Estimated near Baghdad". Null
   * for every other state.
   */
  anchorCity: string | null;
  /** Freshness of the driver fix; status "none" for estimated/unavailable. */
  freshness: GpsFreshness;
  /** Minutes since the driver fix, when known; null otherwise. */
  minutesAgo: number | null;
}

/**
 * Geographic coordinates for the cities eTIR operates between (land
 * corridor: Turkey ↔ Iraq). Exported so the map components share exactly
 * one city table instead of each keeping their own copy. This is reference
 * geography, not shipment data — it is never seeded, migrated or edited.
 */
export const CITY_COORDINATES: Record<string, GeoCoord> = {
  istanbul: { lat: 41.0082, lng: 28.9784 },
  bursa: { lat: 40.1885, lng: 29.061 },
  gaziantep: { lat: 37.0662, lng: 37.3833 },
  erbil: { lat: 36.1912, lng: 44.0091 },
  baghdad: { lat: 33.3152, lng: 44.3661 },
  basra: { lat: 30.5081, lng: 47.7835 },
  zaho: { lat: 37.1436, lng: 42.6886 },
  dahuk: { lat: 36.8615, lng: 42.9926 },
  mosul: { lat: 36.3489, lng: 43.1577 },
  suleymaniye: { lat: 35.5613, lng: 45.4375 },
  kirkuk: { lat: 35.467, lng: 44.392 },
  ankara: { lat: 39.9334, lng: 32.8597 },
};

/**
 * Shipment statuses that mean the truck has not left the origin yet, so an
 * estimated position should anchor to the LOADING (origin) city. Every
 * other status anchors to the DELIVERY (destination) city.
 */
export const PRE_DEPARTURE_STATUSES: readonly string[] = [
  "New",
  "Waiting for Driver Quotes",
  "Assigned",
  "Accepted",
  "Loading",
  "Loaded",
];

/** Human-facing labels for each tracking state (English + Arabic). */
export interface TrackingStateLabel {
  en: string;
  ar: string;
}

export const TRACKING_STATE_LABELS: Record<TrackingState, TrackingStateLabel> = {
  live_gps: { en: "Live GPS", ar: "تتبع مباشر" },
  last_reported: { en: "Last Reported", ar: "آخر موقع مُبلَّغ" },
  estimated: { en: "Estimated Position", ar: "موقع تقديري" },
  unavailable: { en: "Location Unavailable", ar: "الموقع غير متوفّر" },
};

/**
 * A driver coordinate is only usable when both parts are finite numbers and
 * neither is exactly 0 — a (0,0) "null island" pair is the sentinel used
 * across the app for "never reported", not a real fix off West Africa.
 */
export function hasUsableDriverGps(
  driver: Pick<Driver, "latitude" | "longitude"> | null | undefined
): boolean {
  if (!driver) return false;
  const { latitude, longitude } = driver;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0
  );
}

/**
 * Resolve a free-text city name to a known coordinate, or null when the
 * city is not recognized. Tries an exact normalized match first, then a
 * conservative substring match (so "Baghdad, Iraq" still resolves), and
 * returns null rather than ever defaulting to a fallback city.
 */
export function resolveCityCoord(
  city: string | null | undefined
): { key: string; coord: GeoCoord } | null {
  if (!city) return null;
  const norm = city.toLowerCase().trim();
  if (!norm) return null;

  if (CITY_COORDINATES[norm]) {
    return { key: norm, coord: CITY_COORDINATES[norm] };
  }
  for (const key of Object.keys(CITY_COORDINATES)) {
    if (norm.includes(key) || key.includes(norm)) {
      return { key, coord: CITY_COORDINATES[key] };
    }
  }
  return null;
}

/**
 * Project a geographic coordinate onto the Vector Radar's 850×550 SVG grid.
 * Kept identical to the legacy projection (lng 28–48 → x 100–725, lat
 * 30–42 → y 465–130, clamped) so the radar layout is unchanged; extracted
 * here only so both map modes and the tests share one implementation.
 */
export function projectGeoToVector(lat: number, lng: number): { x: number; y: number } {
  const LAT_MIN = 30.0;
  const LAT_MAX = 42.0;
  const LNG_MIN = 28.0;
  const LNG_MAX = 48.0;

  const pctX = (lng - LNG_MIN) / (LNG_MAX - LNG_MIN);
  const x = 100 + pctX * 625;

  const pctY = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN);
  const y = 465 - pctY * 335;

  return {
    x: Math.min(800, Math.max(50, x)),
    y: Math.min(500, Math.max(50, y)),
  };
}

const NO_FRESHNESS: GpsFreshness = { status: "none", minutesAgo: null };

/**
 * The single source of truth for a shipment's map placement and honesty
 * state. Given the shipment, its assigned driver (if any) and the current
 * time, returns which of the four states applies and the real coordinate
 * to use (or null when unavailable).
 *
 * Decision order:
 *   1. Real driver GPS present → live_gps (fresh) or last_reported (stale
 *      or timestamp-less). The coordinate is the driver's own fix.
 *   2. No driver GPS but a recognizable anchor city (origin before
 *      departure, destination otherwise) → estimated at that city.
 *   3. Neither → unavailable, with a null coordinate and NO fallback city.
 */
export function resolveTrackingPosition(
  shipment: Pick<Shipment, "status" | "loadingCity" | "deliveryCity">,
  driver: Pick<Driver, "latitude" | "longitude" | "lastUpdated"> | null | undefined,
  nowMs: number
): TrackingPosition {
  // 1. Real driver GPS — the only "isReal" states.
  if (hasUsableDriverGps(driver)) {
    const freshness = getGpsFreshness(driver!.lastUpdated, nowMs);
    // status "fresh" → live; "stale" or "none" (no timestamp) → last reported.
    const state: TrackingState = freshness.status === "fresh" ? "live_gps" : "last_reported";
    return {
      state,
      lat: driver!.latitude as number,
      lng: driver!.longitude as number,
      isReal: true,
      source: "driver_gps",
      anchorCity: null,
      freshness,
      minutesAgo: freshness.minutesAgo,
    };
  }

  // 2. No GPS — estimate from a known city anchor.
  const preDeparture = PRE_DEPARTURE_STATUSES.includes(shipment.status);
  const anchorName = preDeparture ? shipment.loadingCity : shipment.deliveryCity;
  const resolved = resolveCityCoord(anchorName);
  if (resolved) {
    return {
      state: "estimated",
      lat: resolved.coord.lat,
      lng: resolved.coord.lng,
      isReal: false,
      source: preDeparture ? "origin_city" : "destination_city",
      anchorCity: resolved.key,
      freshness: NO_FRESHNESS,
      minutesAgo: null,
    };
  }

  // 3. No GPS and no recognizable city — honestly unavailable. NEVER falls
  //    back to Istanbul / Baghdad; the shipment keeps its place in the list.
  return {
    state: "unavailable",
    lat: null,
    lng: null,
    isReal: false,
    source: "none",
    anchorCity: null,
    freshness: NO_FRESHNESS,
    minutesAgo: null,
  };
}
