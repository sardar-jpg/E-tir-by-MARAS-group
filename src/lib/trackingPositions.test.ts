import { describe, it, expect } from "vitest";
import {
  resolveTrackingPosition,
  resolveCityCoord,
  hasUsableDriverGps,
  projectGeoToVector,
  CITY_COORDINATES,
  PRE_DEPARTURE_STATUSES,
  TRACKING_STATE_LABELS,
  type TrackingState,
} from "./trackingPositions";
import type { Driver, Shipment } from "../types";

const NOW = new Date("2026-07-23T12:00:00.000Z").getTime();

function minutesAgoIso(mins: number): string {
  return new Date(NOW - mins * 60000).toISOString();
}

/** Minimal shipment stub — only the fields resolveTrackingPosition reads. */
function ship(overrides: Partial<Shipment> = {}): Pick<Shipment, "status" | "loadingCity" | "deliveryCity"> {
  return {
    status: "In Transit",
    loadingCity: "Istanbul",
    deliveryCity: "Baghdad",
    ...overrides,
  } as Pick<Shipment, "status" | "loadingCity" | "deliveryCity">;
}

/** Minimal driver stub — only latitude/longitude/lastUpdated matter here. */
function drv(overrides: Partial<Driver> = {}): Pick<Driver, "latitude" | "longitude" | "lastUpdated"> {
  return { latitude: 38.0, longitude: 40.0, lastUpdated: minutesAgoIso(5), ...overrides };
}

describe("hasUsableDriverGps", () => {
  it("is false for missing driver or missing coordinates", () => {
    expect(hasUsableDriverGps(null)).toBe(false);
    expect(hasUsableDriverGps(undefined)).toBe(false);
    expect(hasUsableDriverGps({ latitude: undefined, longitude: undefined })).toBe(false);
    expect(hasUsableDriverGps({ latitude: 38, longitude: undefined })).toBe(false);
  });

  it("treats (0,0) null island as 'never reported', not a real fix", () => {
    expect(hasUsableDriverGps({ latitude: 0, longitude: 0 })).toBe(false);
    expect(hasUsableDriverGps({ latitude: 0, longitude: 44 })).toBe(false);
    expect(hasUsableDriverGps({ latitude: 33, longitude: 0 })).toBe(false);
  });

  it("rejects NaN / Infinity coordinates", () => {
    expect(hasUsableDriverGps({ latitude: NaN, longitude: 40 })).toBe(false);
    expect(hasUsableDriverGps({ latitude: 38, longitude: Infinity })).toBe(false);
  });

  it("is true for a genuine finite non-zero fix", () => {
    expect(hasUsableDriverGps({ latitude: 38, longitude: 40 })).toBe(true);
  });
});

describe("resolveCityCoord", () => {
  it("resolves an exact normalized city name", () => {
    expect(resolveCityCoord("Baghdad")).toEqual({ key: "baghdad", coord: CITY_COORDINATES.baghdad });
    expect(resolveCityCoord("  ISTANBUL  ")).toEqual({ key: "istanbul", coord: CITY_COORDINATES.istanbul });
  });

  it("resolves a decorated city name via substring match", () => {
    expect(resolveCityCoord("Baghdad, Iraq")?.key).toBe("baghdad");
    expect(resolveCityCoord("Erbil Governorate")?.key).toBe("erbil");
  });

  it("returns null for empty / missing / unknown cities — never a fallback", () => {
    expect(resolveCityCoord("")).toBeNull();
    expect(resolveCityCoord(null)).toBeNull();
    expect(resolveCityCoord(undefined)).toBeNull();
    expect(resolveCityCoord("Atlantis")).toBeNull();
    expect(resolveCityCoord("Springfield")).toBeNull();
  });
});

describe("resolveTrackingPosition — Live GPS (fresh real fix)", () => {
  it("returns live_gps at the driver coordinate when the fix is recent", () => {
    const pos = resolveTrackingPosition(ship(), drv({ latitude: 36.19, longitude: 44.0, lastUpdated: minutesAgoIso(3) }), NOW);
    expect(pos.state).toBe("live_gps");
    expect(pos.lat).toBe(36.19);
    expect(pos.lng).toBe(44.0);
    expect(pos.isReal).toBe(true);
    expect(pos.source).toBe("driver_gps");
    expect(pos.anchorCity).toBeNull();
    expect(pos.freshness.status).toBe("fresh");
    expect(pos.minutesAgo).toBe(3);
  });

  it("treats exactly the 30-minute threshold as still live", () => {
    const pos = resolveTrackingPosition(ship(), drv({ lastUpdated: minutesAgoIso(30) }), NOW);
    expect(pos.state).toBe("live_gps");
  });
});

describe("resolveTrackingPosition — Last Reported (stale / undated real fix)", () => {
  it("returns last_reported for a real but stale fix, keeping the real coordinate", () => {
    const pos = resolveTrackingPosition(ship(), drv({ latitude: 35.5, longitude: 43.2, lastUpdated: minutesAgoIso(90) }), NOW);
    expect(pos.state).toBe("last_reported");
    expect(pos.lat).toBe(35.5);
    expect(pos.lng).toBe(43.2);
    expect(pos.isReal).toBe(true);
    expect(pos.source).toBe("driver_gps");
    expect(pos.freshness.status).toBe("stale");
    expect(pos.minutesAgo).toBe(90);
  });

  it("returns last_reported when coordinates exist but there is no timestamp", () => {
    const pos = resolveTrackingPosition(ship(), drv({ latitude: 35.5, longitude: 43.2, lastUpdated: undefined }), NOW);
    expect(pos.state).toBe("last_reported");
    expect(pos.isReal).toBe(true);
    expect(pos.freshness.status).toBe("none");
    expect(pos.minutesAgo).toBeNull();
  });

  it("just past the threshold (31 min) becomes last_reported", () => {
    const pos = resolveTrackingPosition(ship(), drv({ lastUpdated: minutesAgoIso(31) }), NOW);
    expect(pos.state).toBe("last_reported");
  });
});

describe("resolveTrackingPosition — Estimated (no GPS, known city anchor)", () => {
  it("anchors a pre-departure shipment to its ORIGIN city", () => {
    for (const status of PRE_DEPARTURE_STATUSES) {
      const pos = resolveTrackingPosition(
        ship({ status: status as Shipment["status"], loadingCity: "Erbil", deliveryCity: "Basra" }),
        null,
        NOW
      );
      expect(pos.state).toBe("estimated");
      expect(pos.source).toBe("origin_city");
      expect(pos.anchorCity).toBe("erbil");
      expect(pos.lat).toBe(CITY_COORDINATES.erbil.lat);
      expect(pos.lng).toBe(CITY_COORDINATES.erbil.lng);
      expect(pos.isReal).toBe(false);
      expect(pos.freshness.status).toBe("none");
    }
  });

  it("anchors an in-transit shipment with no GPS to its DESTINATION city", () => {
    const pos = resolveTrackingPosition(ship({ status: "In Transit", loadingCity: "Istanbul", deliveryCity: "Baghdad" }), null, NOW);
    expect(pos.state).toBe("estimated");
    expect(pos.source).toBe("destination_city");
    expect(pos.anchorCity).toBe("baghdad");
    expect(pos.lat).toBe(CITY_COORDINATES.baghdad.lat);
    expect(pos.isReal).toBe(false);
  });

  it("anchors a delivered/terminal shipment to its DESTINATION city", () => {
    for (const status of ["Arrived", "Delivered", "Closed"] as Shipment["status"][]) {
      const pos = resolveTrackingPosition(ship({ status, deliveryCity: "Mosul" }), null, NOW);
      expect(pos.state).toBe("estimated");
      expect(pos.source).toBe("destination_city");
      expect(pos.anchorCity).toBe("mosul");
    }
  });

  it("estimates when a driver exists but has no usable GPS", () => {
    const pos = resolveTrackingPosition(ship({ deliveryCity: "Kirkuk" }), drv({ latitude: 0, longitude: 0 }), NOW);
    expect(pos.state).toBe("estimated");
    expect(pos.anchorCity).toBe("kirkuk");
  });
});

describe("resolveTrackingPosition — Location Unavailable (no silent fallback)", () => {
  it("is unavailable with a null coordinate when the anchor city is unknown", () => {
    const pos = resolveTrackingPosition(ship({ status: "In Transit", loadingCity: "Atlantis", deliveryCity: "Nowhere" }), null, NOW);
    expect(pos.state).toBe("unavailable");
    expect(pos.lat).toBeNull();
    expect(pos.lng).toBeNull();
    expect(pos.source).toBe("none");
    expect(pos.anchorCity).toBeNull();
    expect(pos.isReal).toBe(false);
  });

  it("NEVER falls back to Istanbul or Baghdad for an unknown pre-departure origin", () => {
    const pos = resolveTrackingPosition(ship({ status: "Loading", loadingCity: "Nowhereville", deliveryCity: "Baghdad" }), null, NOW);
    // pre-departure anchors to ORIGIN; origin is unknown -> unavailable, NOT a Baghdad/Istanbul guess
    expect(pos.state).toBe("unavailable");
    expect(pos.lat).toBeNull();
    expect(pos.lng).toBeNull();
  });

  it("does not borrow the destination when a pre-departure origin is unknown", () => {
    const pos = resolveTrackingPosition(ship({ status: "Assigned", loadingCity: "Unknown City", deliveryCity: "Erbil" }), null, NOW);
    expect(pos.state).toBe("unavailable");
  });
});

describe("resolveTrackingPosition — real GPS always wins over city anchoring", () => {
  it("uses the driver fix even when the city is unknown", () => {
    const pos = resolveTrackingPosition(ship({ loadingCity: "Atlantis", deliveryCity: "Nowhere" }), drv({ latitude: 34, longitude: 43, lastUpdated: minutesAgoIso(2) }), NOW);
    expect(pos.state).toBe("live_gps");
    expect(pos.lat).toBe(34);
    expect(pos.isReal).toBe(true);
  });
});

describe("projectGeoToVector", () => {
  it("keeps the legacy projection math (lng 28→48 across x 100..725)", () => {
    // lng = 28 -> x = 100; lng = 48 -> x = 725 (both within clamp)
    expect(projectGeoToVector(30, 28).x).toBeCloseTo(100, 5);
    expect(projectGeoToVector(30, 48).x).toBeCloseTo(725, 5);
    // lat = 30 -> y = 465; lat = 42 -> y = 130
    expect(projectGeoToVector(30, 28).y).toBeCloseTo(465, 5);
    expect(projectGeoToVector(42, 28).y).toBeCloseTo(130, 5);
  });

  it("clamps extreme coordinates into the [50,800]×[50,500] grid", () => {
    const far = projectGeoToVector(90, 120);
    expect(far.x).toBeLessThanOrEqual(800);
    expect(far.x).toBeGreaterThanOrEqual(50);
    expect(far.y).toBeLessThanOrEqual(500);
    expect(far.y).toBeGreaterThanOrEqual(50);
  });
});

describe("tracking state labels", () => {
  it("provides an English and Arabic label for every state", () => {
    const states: TrackingState[] = ["live_gps", "last_reported", "estimated", "unavailable"];
    for (const s of states) {
      expect(TRACKING_STATE_LABELS[s].en.length).toBeGreaterThan(0);
      expect(TRACKING_STATE_LABELS[s].ar.length).toBeGreaterThan(0);
    }
  });
});
