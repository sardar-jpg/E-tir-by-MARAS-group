// Offline (no Google Maps key) distance/ETA estimate helpers for the
// distance-matrix endpoint. Kept pure and separate from server.ts so the
// route-resolution logic can be unit tested without Express/Firestore.

export interface Coords {
  lat: number;
  lng: number;
}

// Known land cities used for the Turkey<->Iraq trucking corridor. This
// table intentionally does not include seaports or airports - sea/air
// routes must resolve through resolveRouteCoords returning null instead
// of silently reusing a land city match.
export const CITY_COORDS: Record<string, Coords> = {
  istanbul: { lat: 41.0082, lng: 28.9784 },
  bursa: { lat: 40.1885, lng: 29.0610 },
  gaziantep: { lat: 37.0662, lng: 37.3833 },
  erbil: { lat: 36.1912, lng: 44.0091 },
  baghdad: { lat: 33.3152, lng: 44.3661 },
  basra: { lat: 30.5081, lng: 47.7835 },
  zaho: { lat: 37.1436, lng: 42.6886 },
  dahuk: { lat: 36.8615, lng: 42.9926 },
  mosul: { lat: 36.3489, lng: 43.1577 },
  suleymaniye: { lat: 35.5613, lng: 45.4375 },
  kirkuk: { lat: 35.4670, lng: 44.3920 },
  ankara: { lat: 39.9334, lng: 32.8597 },
};

const DEFAULT_ORIGIN: Coords = CITY_COORDS.istanbul;
const DEFAULT_DESTINATION: Coords = CITY_COORDS.baghdad;

export function findCityCoords(location: string): Coords | null {
  const norm = location.toLowerCase().trim();
  const matchKey = Object.keys(CITY_COORDS).find(k => norm.includes(k) || k.includes(norm));
  return matchKey ? CITY_COORDS[matchKey] : null;
}

export type FreightType = "land" | "sea" | "air" | undefined;

export function isLandFreight(freightType: FreightType): boolean {
  return freightType !== "sea" && freightType !== "air";
}

/**
 * Resolves start/end coordinates for the offline haversine estimate.
 * Land routes keep the pre-existing behavior of defaulting to the
 * Istanbul<->Baghdad corridor when a city isn't recognized. Sea/air
 * routes have no real default corridor to fall back to, so both ends
 * must resolve to known coordinates (or a live GPS origin) - otherwise
 * this returns null and the caller must report the route as unavailable
 * rather than silently reusing the land default (previously this caused
 * unrelated Sea/Air routes to return fabricated Istanbul->Baghdad
 * distances/ETAs).
 */
export function resolveRouteCoords(
  originStr: string,
  destinationStr: string,
  freightType: FreightType,
  liveOrigin: Coords | null
): { origin: Coords; destination: Coords } | null {
  const originCoords = liveOrigin ?? findCityCoords(originStr);
  const destCoords = findCityCoords(destinationStr);

  if (isLandFreight(freightType)) {
    return {
      origin: originCoords ?? DEFAULT_ORIGIN,
      destination: destCoords ?? DEFAULT_DESTINATION,
    };
  }

  if (!originCoords || !destCoords) return null;
  return { origin: originCoords, destination: destCoords };
}

export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export const UNAVAILABLE_DISTANCE_MATRIX_RESPONSE = {
  status: "UNAVAILABLE" as const,
  reason: "Route coordinates unavailable for this freight type or location.",
  distance: null,
  duration: null,
  eta: null,
};
