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

  it("never places a marker for shipments whose position is unavailable", () => {
    // Vector Radar: unavailable shipments are filtered out before clustering
    // (loc.available ? {...} : null), so they never reach the grid.
    expect(TRACKING_MAP).toMatch(/loc\.available \? \{ x: loc\.x/);
    // Google Map: the marker loop still bails out when not placeable.
    expect(TRACKING_MAP).toMatch(/if \(!activeLoc\.available \|\| activeLoc\.lat == null/);
  });

  it("exposes the four honesty states via localized labels", () => {
    for (const key of ["trackLive", "trackReported", "trackEstimated", "trackUnavailable"]) {
      expect(TRACKING_MAP).toContain(key);
    }
  });
});

describe("Phase 2 — Operations Center layout", () => {
  it("makes the shipment panel collapsible so the map can be dominant", () => {
    expect(TRACKING_MAP).toContain("panelCollapsed");
    // Collapsed => map spans the full grid; expanded => 3/9 map-dominant split.
    expect(TRACKING_MAP).toContain("lg:col-span-12");
    expect(TRACKING_MAP).toContain("lg:col-span-9");
    expect(TRACKING_MAP).toContain("lg:col-span-3");
    // The old even 4/8 split must be gone.
    expect(TRACKING_MAP).not.toContain("lg:col-span-8");
    expect(TRACKING_MAP).not.toContain("lg:col-span-4");
  });

  it("renders a real-data status strip from honest state counts", () => {
    expect(TRACKING_MAP).toContain("trackingCounts");
    expect(TRACKING_MAP).toMatch(/trackingCounts\[item\.key\]/);
  });

  it("renames the driver-focus control to 'Focus on Driver GPS' (not 'My Current Location')", () => {
    expect(TRACKING_MAP).toContain("Focus on Driver GPS");
    expect(TRACKING_MAP).not.toContain("My Current Location");
  });

  it("removes the redundant per-row 'Locate on Grid' action button", () => {
    // The card itself is the click target; there must be no inner button that
    // re-fires handleSelectShipment via t.viewOnMap.
    expect(TRACKING_MAP).not.toMatch(/\{t\.viewOnMap\}\s*➔/);
  });
});

describe("Phase 3 — details drawer + on-demand ETA", () => {
  it("provides an on-demand ETA handler that hits the distance-matrix route", () => {
    expect(TRACKING_MAP).toContain("handleCalculateEta");
    expect(TRACKING_MAP).toMatch(/\/api\/shipments\/\$\{s\.id\}\/distance-matrix/);
  });

  it("never auto-calls the ETA route (only wired to onClick, not an effect)", () => {
    // handleCalculateEta must not appear inside any useEffect dependency/body.
    const effects = TRACKING_MAP.match(/useEffect\([\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/g) || [];
    for (const eff of effects) {
      expect(eff).not.toContain("handleCalculateEta");
      expect(eff).not.toContain("distance-matrix");
    }
  });

  it("ties the ETA result to the selected shipment and clears it on re-selection", () => {
    expect(TRACKING_MAP).toContain("etaForId");
    // handleSelectShipment resets the ETA state so it never leaks across shipments.
    const selectHandler = TRACKING_MAP.slice(
      TRACKING_MAP.indexOf("const handleSelectShipment"),
      TRACKING_MAP.indexOf("const handleAutoFocusRoute")
    );
    expect(selectHandler).toContain("setEtaData(null)");
    expect(selectHandler).toContain("setEtaForId(null)");
  });

  it("renders the five ETA states (idle / loading / error / unavailable / success)", () => {
    expect(TRACKING_MAP).toContain("etaLoading");
    expect(TRACKING_MAP).toContain("etaError");
    expect(TRACKING_MAP).toMatch(/eta\.status === "UNAVAILABLE"/);
    expect(TRACKING_MAP).toMatch(/Calculate ETA & Distance/);
  });

  it("selection stays unified: list rows and both map marker sets drive handleSelectShipment", () => {
    const occurrences = (TRACKING_MAP.match(/handleSelectShipment\(s\)/g) || []).length;
    // list row + vector marker + google marker = at least three call sites.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});

describe("Phase 4 — componentization, clustering, legend, loaded-50 notice", () => {
  const LEGEND = readFileSync(join(__dirname, "admin", "tracking", "TrackingLegend.tsx"), "utf-8");

  it("extracts the map legend into admin/tracking and uses it in TrackingMap", () => {
    expect(TRACKING_MAP).toContain('import TrackingLegend from "./admin/tracking/TrackingLegend"');
    expect(TRACKING_MAP).toContain("<TrackingLegend");
    // The old verbose inline legend content must be gone.
    expect(TRACKING_MAP).not.toContain("Shipment Milestones");
    expect(TRACKING_MAP).not.toContain("Truck Categorization");
  });

  it("the legend honestly documents the four tracking-confidence states", () => {
    expect(LEGEND).toContain("live_gps");
    expect(LEGEND).toContain("last_reported");
    expect(LEGEND).toContain("estimated");
    expect(LEGEND).toContain("unavailable");
  });

  it("wires the pure clusterMarkers lib into the Vector Radar", () => {
    expect(TRACKING_MAP).toContain('import { clusterMarkers } from "../lib/markerClustering"');
    expect(TRACKING_MAP).toContain("vectorClusters");
    expect(TRACKING_MAP).toContain("clusterMarkers(");
    // Cluster bubbles render a count when more than one marker is grouped.
    expect(TRACKING_MAP).toMatch(/cluster\.count > 1/);
  });

  it("shows an honest loaded-50 notice without changing the backend limit", () => {
    expect(TRACKING_MAP).toContain("loadedCapNotice");
    expect(TRACKING_MAP).toMatch(/shipments\.length >= 50/);
  });
});
