import { describe, it, expect } from "vitest";
import {
  findCityCoords,
  resolveRouteCoords,
  haversineKm,
  isLandFreight,
  CITY_COORDS,
} from "./distanceMatrix";

describe("findCityCoords", () => {
  it("resolves a known land city", () => {
    expect(findCityCoords("Baghdad")).toEqual(CITY_COORDS.baghdad);
    expect(findCityCoords("  istanbul ")).toEqual(CITY_COORDS.istanbul);
  });

  it("returns null for an unrecognized location", () => {
    expect(findCityCoords("Shanghai Port")).toBeNull();
    expect(findCityCoords("Guangzhou")).toBeNull();
  });
});

describe("resolveRouteCoords", () => {
  it("resolves a known land route (Istanbul -> Baghdad)", () => {
    const result = resolveRouteCoords("Istanbul", "Baghdad", "land", null);
    expect(result).toEqual({ origin: CITY_COORDS.istanbul, destination: CITY_COORDS.baghdad });
  });

  it("falls back to the Istanbul/Baghdad default for an unrecognized land city (existing behavior preserved)", () => {
    const result = resolveRouteCoords("Some Unknown Town", "Another Unknown Town", "land", null);
    expect(result).toEqual({ origin: CITY_COORDS.istanbul, destination: CITY_COORDS.baghdad });
  });

  it("does NOT fall back to Istanbul/Baghdad for an unsupported sea route (Mersin Port -> Shanghai Port)", () => {
    const result = resolveRouteCoords("Mersin Port", "Shanghai Port", "sea", null);
    expect(result).toBeNull();
  });

  it("does NOT fall back to Istanbul/Baghdad for an unsupported air route (Guangzhou -> Baghdad)", () => {
    const result = resolveRouteCoords("Guangzhou", "Baghdad", "air", null);
    expect(result).toBeNull();
  });

  it("supports a sea/air route when both endpoints resolve to known coordinates", () => {
    const result = resolveRouteCoords("Erbil", "Baghdad", "air", null);
    expect(result).toEqual({ origin: CITY_COORDS.erbil, destination: CITY_COORDS.baghdad });
  });

  it("prefers a live driver GPS origin over a city-name match for land routes", () => {
    const liveOrigin = { lat: 36.5, lng: 43.1 };
    const result = resolveRouteCoords("Istanbul", "Baghdad", "land", liveOrigin);
    expect(result).toEqual({ origin: liveOrigin, destination: CITY_COORDS.baghdad });
  });
});

describe("isLandFreight", () => {
  it("treats undefined/land as land freight", () => {
    expect(isLandFreight(undefined)).toBe(true);
    expect(isLandFreight("land")).toBe(true);
  });

  it("treats sea/air as non-land freight", () => {
    expect(isLandFreight("sea")).toBe(false);
    expect(isLandFreight("air")).toBe(false);
  });
});

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(CITY_COORDS.baghdad, CITY_COORDS.baghdad)).toBe(0);
  });

  it("computes a plausible Istanbul -> Baghdad great-circle distance", () => {
    const km = haversineKm(CITY_COORDS.istanbul, CITY_COORDS.baghdad);
    expect(km).toBeGreaterThan(1500);
    expect(km).toBeLessThan(1700);
  });
});
