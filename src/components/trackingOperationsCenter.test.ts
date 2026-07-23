import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { canViewGpsTracking } from "../lib/adminAccess";

/**
 * feature/gps-tracking-operations-center — Phase 0 safety net.
 *
 * The GPS Tracking page is being redesigned into an Operations Center. This
 * redesign changes a lot of TrackingMap.tsx, so before touching it we pin
 * the four invariants the redesign must NEVER regress — the ones that are
 * about security and data-contract, not layout:
 *
 *   1. Permission gate — only super/operation admins may see GPS tracking;
 *      accounts admins are blocked. (canViewGpsTracking + its use in the
 *      AdminPanel render path.)
 *   2. Maps-key guard — GET /api/maps-key stays behind requireAuth so the
 *      Google Maps key is never served to an unauthenticated caller.
 *   3. Land-only scope — the tracking map only ever receives land freight
 *      shipments (air/sea are out of the map's scope).
 *   4. Both map modes preserved — the Vector Radar and the Google Map view
 *      modes both remain available.
 *
 * Same source-scan approach as AdminPanel.test.ts / LoginPage.test.ts: the
 * project's vitest runs in a plain node env with no jsdom/testing-library,
 * so component wiring is verified by reading the real source, not rendering.
 */

const ROOT = join(__dirname, "..", "..");
const ADMIN_PANEL = readFileSync(join(__dirname, "AdminPanel.tsx"), "utf-8");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const TRACKING_MAP = readFileSync(join(__dirname, "TrackingMap.tsx"), "utf-8");

describe("Invariant 1 — GPS tracking permission gate (super/operation only)", () => {
  it("canViewGpsTracking allows super and operation, blocks accounts and others", () => {
    expect(canViewGpsTracking("super")).toBe(true);
    expect(canViewGpsTracking("operation")).toBe(true);
    expect(canViewGpsTracking("accounts")).toBe(false);
    expect(canViewGpsTracking(undefined)).toBe(false);
  });

  it("AdminPanel renders the tracking tab only behind canViewGpsTracking", () => {
    expect(ADMIN_PANEL).toMatch(
      /activeTab === 'tracking_map' && canViewGpsTracking\(resolvedAdminType\)/
    );
  });

  it("AdminPanel guards the tracking quick-link navigation with canViewGpsTracking", () => {
    // The dashboard quick-link that switches to the tracking tab must itself
    // be gated, so an accounts admin can never navigate to it programmatically.
    expect(ADMIN_PANEL).toMatch(
      /if \(canViewGpsTracking\(resolvedAdminType\)\) setActiveTab\('tracking_map'\)/
    );
  });
});

describe("Invariant 2 — /api/maps-key stays behind requireAuth", () => {
  it("registers the maps-key route with the requireAuth middleware", () => {
    expect(SERVER).toMatch(/app\.get\(\s*["']\/api\/maps-key["']\s*,\s*requireAuth\s*,/);
  });
});

describe("Invariant 3 — tracking map is scoped to land freight only", () => {
  it("AdminPanel passes only land-freight shipments into TrackingMap", () => {
    expect(ADMIN_PANEL).toMatch(
      /<TrackingMap[\s\S]*?shipments=\{shipments\.filter\(s => \(s\.freightType \|\| "land"\) === "land"\)\}/
    );
  });
});

describe("Invariant 4 — both map view modes remain available", () => {
  it("TrackingMap still supports the vector and google_map view modes", () => {
    expect(TRACKING_MAP).toMatch(/useState<'vector' \| 'google_map'>/);
    expect(TRACKING_MAP).toContain("google_map");
    expect(TRACKING_MAP).toContain("'vector'");
  });

  it("TrackingMap keeps the honest resolveTrackingStatus source of truth", () => {
    // The redesign must not resurrect the old unconditional "Live" claim;
    // the status must still flow through resolveTrackingStatus.
    expect(TRACKING_MAP).toContain("resolveTrackingStatus");
  });
});

describe("Phase 1 — tracking honesty applied in TrackingMap", () => {
  it("drives shipment placement through the pure resolveTrackingPosition lib", () => {
    expect(TRACKING_MAP).toContain("resolveTrackingPosition");
    expect(TRACKING_MAP).toContain("trackingById");
  });

  it("removes the 4-second simulated 'crawl' ticker and its interval", () => {
    expect(TRACKING_MAP).not.toMatch(/setInterval\(\s*\(\)\s*=>\s*\{\s*setTicker/);
    expect(TRACKING_MAP).not.toContain("setTicker");
    expect(TRACKING_MAP).not.toMatch(/\bticker\s*\+/); // no drift arithmetic on a ticker
  });

  it("removes the silent Istanbul/Baghdad fallback from shipment position resolution", () => {
    // The position helper must no longer default an unknown city to a real
    // coordinate. (CITY_COORDINATES["istanbul"|"baghdad"] may still appear
    // ONLY for framing the Google map bounds / route endpoints, never as a
    // shipment's asserted position — that now comes from resolveTrackingPosition.)
    const posHelper = TRACKING_MAP.slice(
      TRACKING_MAP.indexOf("const getShipmentVectorLocation"),
      TRACKING_MAP.indexOf("const stateColors")
    );
    expect(posHelper.length).toBeGreaterThan(0);
    expect(posHelper).not.toContain('CITY_COORDINATES["istanbul"]');
    expect(posHelper).not.toContain('CITY_COORDINATES["baghdad"]');
    expect(posHelper).not.toContain("hash");
  });

  it("skips rendering a marker for shipments whose position is unavailable", () => {
    // Both the Vector Radar and Google Map marker loops must bail out when
    // the resolved position is not placeable.
    expect(TRACKING_MAP).toMatch(/if \(!activeLoc\.available\) return null;/);
    expect(TRACKING_MAP).toMatch(/if \(!activeLoc\.available \|\| activeLoc\.lat == null/);
  });

  it("exposes the four honesty states via localized labels", () => {
    for (const key of ["trackLive", "trackReported", "trackEstimated", "trackUnavailable"]) {
      expect(TRACKING_MAP).toContain(key);
    }
  });
});
