import { describe, it, expect } from "vitest";
import { isGoogleMapsLive, resolveTrackingStatus } from "./trackingMapStatus";

describe("isGoogleMapsLive", () => {
  it("is true only when google_map mode + a valid key + no auth error", () => {
    expect(isGoogleMapsLive({ mapViewMode: "google_map", hasValidMapsKey: true, mapsAuthError: false })).toBe(true);
  });

  it("is false with no configured key, even in google_map mode", () => {
    expect(isGoogleMapsLive({ mapViewMode: "google_map", hasValidMapsKey: false, mapsAuthError: false })).toBe(false);
  });

  it("is false on an auth failure, even with a key configured", () => {
    expect(isGoogleMapsLive({ mapViewMode: "google_map", hasValidMapsKey: true, mapsAuthError: true })).toBe(false);
  });

  it("is false with both a missing key and an auth error", () => {
    expect(isGoogleMapsLive({ mapViewMode: "google_map", hasValidMapsKey: false, mapsAuthError: true })).toBe(false);
  });

  it("is always false in vector mode, regardless of key/auth state", () => {
    expect(isGoogleMapsLive({ mapViewMode: "vector", hasValidMapsKey: true, mapsAuthError: false })).toBe(false);
    expect(isGoogleMapsLive({ mapViewMode: "vector", hasValidMapsKey: false, mapsAuthError: true })).toBe(false);
  });
});

describe("resolveTrackingStatus", () => {
  it("returns 'vector' whenever mode is vector, regardless of maps key/auth state", () => {
    expect(resolveTrackingStatus({ mapViewMode: "vector", hasValidMapsKey: true, mapsAuthError: false })).toBe("vector");
    expect(resolveTrackingStatus({ mapViewMode: "vector", hasValidMapsKey: false, mapsAuthError: true })).toBe("vector");
  });

  it("returns 'live' only when actually connected", () => {
    expect(resolveTrackingStatus({ mapViewMode: "google_map", hasValidMapsKey: true, mapsAuthError: false })).toBe("live");
  });

  it("returns 'not_configured' when no key is set, never 'live'", () => {
    expect(resolveTrackingStatus({ mapViewMode: "google_map", hasValidMapsKey: false, mapsAuthError: false })).toBe("not_configured");
  });

  it("returns 'demo' when a key exists but an auth error occurred — never 'live'", () => {
    expect(resolveTrackingStatus({ mapViewMode: "google_map", hasValidMapsKey: true, mapsAuthError: true })).toBe("demo");
  });

  it("never returns 'live' unless google_map + valid key + no auth error all hold", () => {
    const allStates: Array<[boolean, boolean]> = [[true, true], [true, false], [false, true], [false, false]];
    for (const [hasValidMapsKey, mapsAuthError] of allStates) {
      const status = resolveTrackingStatus({ mapViewMode: "google_map", hasValidMapsKey, mapsAuthError });
      if (status === "live") {
        expect(hasValidMapsKey).toBe(true);
        expect(mapsAuthError).toBe(false);
      }
    }
  });
});
