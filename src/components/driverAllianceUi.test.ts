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

  it("offers exactly the allowed driver actions: one USD price (confirmed) or Reject (optional reason) — nothing else", () => {
    expect(SOURCE).toContain('submit(o, "quote")');
    expect(SOURCE).toContain('submit(o, "reject")');
    expect(SOURCE).toContain("MAX_QUOTE_PRICE_USD");
    expect(SOURCE).toContain("reasonPlaceholder");
    // No chat, no counter-offers, no currency choice, no accept-only action.
    expect(SOURCE).not.toContain("textarea");
    expect(SOURCE).not.toContain("<select");
    expect(SOURCE).not.toMatch(/EUR|TRY|IQD/);
  });

  it("requires a clear confirmation step before the one-and-only price submission", () => {
    expect(SOURCE).toContain('setPhase("confirming")');
    expect(SOURCE).toContain("confirmWarning");
    expect(SOURCE).toContain("You can submit one price only. It cannot be changed later.");
  });

  it("is localized in English, Turkish, and Arabic (Offers tab)", () => {
    for (const needle of ['title: "Offers"', '"Teklifler"', '"العروض"']) {
      expect(SOURCE).toContain(needle);
    }
  });

  it("an answered offer can never be re-answered from the UI (quoted/rejected/closed render read-only states)", () => {
    expect(SOURCE).toContain('o.myResponse.status === "quoted"');
    expect(SOURCE).toContain('o.myResponse.status === "rejected"');
    expect(SOURCE).toContain('o.myResponse.status === "closed"');
    expect(SOURCE).toContain('const canAnswer = o.status === "broadcast" && !answered && !hasActiveJob;');
  });

  it("a driver with an active job gets a paused banner and no answer controls", () => {
    expect(SOURCE).toContain("hasActiveJob &&");
    expect(SOURCE).toContain("pausedBanner");
  });

  it("shows the required card facts (truck type, loading date, expiry, distance when available) and the fixed lost/expired messages", () => {
    expect(SOURCE).toContain("truckTypeLabel");
    expect(SOURCE).toContain("expectedLoadingDate");
    expect(SOURCE).toContain("expiresAt");
    expect(SOURCE).toContain("distanceKm");
    expect(SOURCE).toContain("Another driver has been selected. Thank you for your quotation.");
    expect(SOURCE).toContain("This offer has expired.");
  });

  it("navigation is the six-section bar with Offers as a first-class tab", () => {
    const NAV = read("driver/DriverBottomNavigation.tsx");
    expect(NAV).toContain('const TABS: DriverTab[] = ["home", "offers", "job", "chat", "documents", "profile"];');
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("activeTab === 'offers'");
    expect(APP).toContain("hasActiveJob={!!activeJob}");
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

  it("offer requests carry an expiry choice, per-request counts, and lowest-price-first review ordering", () => {
    expect(OFFERS).toContain("OFFER_EXPIRY_HOURS_OPTIONS");
    expect(OFFERS).toContain("expiresInHours");
    expect(OFFERS).toContain("summarizeResponses(");
    expect(OFFERS).toContain("sortResponsesForReview(selected.responses)");
    expect(OFFERS).toContain("Quotations sorted lowest price first");
    // Expired offers still allow winner selection — only new answers stop.
    expect(OFFERS).toContain('(selected.offer.status === "broadcast" || selected.offer.status === "expired") && r.status === "quoted"');
  });
});

describe("Driver 'Available for Offers' switch", () => {
  it("lives on the Home screen and saves through the driver's own PUT /api/drivers/:id", () => {
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).toContain("Available for Offers");
    expect(HOME).toContain("Tekliflere Açık");
    expect(HOME).toContain("متاح لعروض النقل");
    expect(HOME).toContain("availableForOffers: !offersEnabled");
    // Absent counts as available — legacy profiles stay opted in.
    expect(HOME).toContain('driver?.availableForOffers !== false');
  });

  it("the Profile screen shows the availability status read-only", () => {
    const ACCOUNT = read("driver/DriverAccountScreen.tsx");
    expect(ACCOUNT).toContain('driver?.availableForOffers !== false');
    expect(ACCOUNT).not.toContain("availableForOffers: !offersEnabled");
  });
});
