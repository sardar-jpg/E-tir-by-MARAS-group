import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Driver Alliance Phase 1 — UI contracts (source-level; no jsdom harness
 * in this repo). The driver offers screen also automatically falls under
 * driverAppRedesign.test.ts's RTL/privacy/jargon scans by living in the
 * driver components directory.
 */
function read(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf-8");
}

describe("DriverOffersScreen — deliberately tiny", () => {
  const SOURCE = read("driver/DriverOffersScreen.tsx");

  it("offers exactly the allowed driver actions: Accept to Quote, Reject, Submit Price (USD), optional note — nothing else", () => {
    expect(SOURCE).toContain('submit("quote")');
    expect(SOURCE).toContain('submit("reject")');
    expect(SOURCE).toContain("MAX_QUOTE_PRICE_USD");
    // No chat, no counter-offers, no currency choice.
    expect(SOURCE).not.toContain("textarea");
    expect(SOURCE).not.toContain("<select");
    expect(SOURCE).not.toMatch(/EUR|TRY|IQD/);
  });

  it("is localized in English, Turkish, and Arabic", () => {
    for (const needle of ["Transport Offers", "Taşıma Teklifleri", "عروض النقل"]) {
      expect(SOURCE).toContain(needle);
    }
  });

  it("an answered offer can never be re-answered from the UI (quoted/rejected render read-only states)", () => {
    expect(SOURCE).toContain('open.myResponse.status === "quoted"');
    expect(SOURCE).toContain('open.myResponse.status === "rejected"');
    expect(SOURCE).toContain('const canAnswer = open.status === "broadcast" && !answered;');
  });

  it("navigation stays four-tab: the offers screen is an overlay, not a tab", () => {
    const NAV = read("driver/DriverBottomNavigation.tsx");
    expect(NAV).toContain('const TABS: DriverTab[] = ["home", "jobs", "chat", "account"];');
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("setShowOffers(true)");
    expect(APP).not.toMatch(/"offers"\s*\|/);
  });
});

describe("Admin Driver Alliance page enhancements", () => {
  const PANEL = read("AdminPanel.tsx");
  const OFFERS = read("admin/DriverAllianceOffers.tsx");
  const ROUTES = read("admin/DriverRouteEditor.tsx");

  it("the offers panel lives inside the existing Driver Alliance tab, gated to super/operation admins", () => {
    expect(PANEL).toContain("const canManageAllianceUi = resolvedAdminType === 'super' || resolvedAdminType === 'operation';");
    expect(PANEL).toContain("{canManageAllianceUi && (");
    expect(PANEL).toContain("<DriverAllianceOffers");
  });

  it("driver cards derive Available/Busy/Inactive from the shared rule the server's matching uses", () => {
    expect(PANEL).toContain("computeBusyDriverIds(shipments)");
    expect(PANEL).toContain("resolveDriverAvailability(driver, allianceBusyDriverIds)");
  });

  it("the route editor blocks duplicates client-side and saves through PUT /api/drivers/:id (server re-validates)", () => {
    expect(ROUTES).toContain("isSameRoute(r, { from: f, to: t })");
    expect(ROUTES).toContain("Duplicate route");
    expect(ROUTES).toContain("/api/drivers/${driver.id}");
    expect(ROUTES).toContain("workingRoutes: nextRoutes");
  });

  it("the offers panel is USD-only and talks only to /api/alliance endpoints", () => {
    expect(OFFERS).toContain("Currency: USD only");
    expect(OFFERS).toContain('currency: "USD"');
    expect(OFFERS).not.toMatch(/EUR|TRY|IQD/);
    expect(OFFERS).toContain('"/api/alliance/offers"');
  });
});
