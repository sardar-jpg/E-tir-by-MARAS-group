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

  it("is localized in English, Turkish, and Arabic (offer sections inside Job)", () => {
    for (const needle of ['newOffers: "New offers"', '"Yeni teklifler"', '"عروض جديدة"']) {
      expect(SOURCE).toContain(needle);
    }
  });

  it("groups offers by what the driver must do: new first, then awaiting decision, then decided", () => {
    expect(SOURCE).toContain("const newOffers = offers.filter(isPending);");
    expect(SOURCE).toContain("const submittedOffers = offers.filter(isSubmitted);");
    expect(SOURCE).toContain("const decidedOffers = offers.filter((o) => !isPending(o) && !isSubmitted(o));");
  });

  it("the collapsed card is a summary only — Shipment Details must be opened before answering", () => {
    expect(SOURCE).toContain('viewDetails: "Shipment Details"');
    expect(SOURCE).toContain('submitPrice: "Submit Price (USD)"');
    // No chat during the offer stage, and no long button text.
    expect(SOURCE).not.toContain("Ask MARAS");
    expect(SOURCE).not.toContain("View Full Shipment Details");
  });

  it("offer details keep only the simple confirmed fields — no speculative logistics fields", () => {
    for (const banned of ["pallet", "Pallet", "dimension", "Dimension", "volume", "Volume", "packaging", "dangerous", "Dangerous", "temperature", "Temperature", "borderCrossing"]) {
      expect(SOURCE).not.toContain(banned);
    }
    // Truck type stays as small reference text only; freight-mode display is gone.
    expect(SOURCE).not.toContain("freightNames");
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

  it("shows the required card facts (route, cargo, loading date, expiry) and the fixed lost/expired messages", () => {
    expect(SOURCE).toContain("truckTypeLabel");
    expect(SOURCE).toContain("expectedLoadingDate");
    expect(SOURCE).toContain("expiresAt");
    expect(SOURCE).toContain("Another driver has been selected. Thank you for your quotation.");
    expect(SOURCE).toContain("This offer has expired.");
  });

  it("navigation is the four-section bar; offers render INSIDE the Job section", () => {
    const NAV = read("driver/DriverBottomNavigation.tsx");
    expect(NAV).toContain('const TABS: DriverTab[] = ["home", "job", "chat", "profile"];');
    const APP = read("DriverApplication.tsx");
    expect(APP).not.toContain("activeTab === 'offers'");
    expect(APP).toContain("offers={allianceOffers}");
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).toContain("<DriverOffersScreen");
    expect(JOB).toContain("hasActiveJob={!!activeJob}");
  });

  it("an offer notification deep-links to the Job section and highlights a pending offer", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("const handleOpenNotification = (n: AppNotification) => {");
    expect(APP).toContain("n.type === 'alliance_offer'");
    expect(APP).toContain("setHighlightOfferId(pending ? pending.id : null);");
    expect(APP).toContain("onOpenNotification={handleOpenNotification}");
    const SCREEN = read("driver/DriverOffersScreen.tsx");
    expect(SCREEN).toContain("highlightOfferId && offers.some((o) => o.id === highlightOfferId)");
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

describe("Order-linked quote requests (Admin)", () => {
  const OFFERS = read("admin/DriverAllianceOffers.tsx");

  it("creation starts from exactly two options: Link to Existing Order or Create New Order (the existing workflow)", () => {
    expect(OFFERS).toContain("Link to Existing Order");
    expect(OFFERS).toContain("Create New Order");
    expect(OFFERS).toContain("onCreateNewOrder?.()");
    // No second Order form: creation posts only the link + alliance settings.
    expect(OFFERS).toContain("orderId: selectedOrder.id");
    expect(OFFERS).not.toContain("pickupCity:");
    expect(OFFERS).not.toContain("cargoDescription:");
  });

  it("the Order search covers MAR reference, customer, origin, and destination — eligible Orders only", () => {
    expect(OFFERS).toContain("[s.shipmentNumber, s.companyName, s.loadingCity, s.loadingCountry, s.deliveryCity, s.deliveryCountry]");
    expect(OFFERS).toContain("isValidMarReference(s.shipmentNumber) && !s.assignedDriverId && !isShipmentClosed(s.status, s.freightType)");
  });

  it("the pre-send preview uses the same pure matching helpers as the server, warns that the customer is hidden, and blocks zero-match sends", () => {
    expect(OFFERS).toContain("matchDriversForOffer(");
    expect(OFFERS).toContain("computeBusyDriverIds(shipments)");
    expect(OFFERS).toContain("Customer / company name is never shown to drivers.");
    expect(OFFERS).toContain("Hidden from drivers");
    expect(OFFERS).toContain("disabled={isBusy || matchedCount === 0}");
  });

  it("AdminPanel reuses the EXISTING Create Order modal and hands the new Order back to the alliance flow", () => {
    const PANEL = read("AdminPanel.tsx");
    expect(PANEL).toContain("setAllianceReturnPending(true);");
    expect(PANEL).toContain("setAlliancePreselectedOrderId(created.id);");
    expect(PANEL).toContain("preselectedOrderId={alliancePreselectedOrderId}");
  });
});

describe("Order fields reach the driver offer", () => {
  it("loading address, delivery address, and weight (kg) render in the driver offer details when present — never as placeholders", () => {
    const SCREEN = read("driver/DriverOffersScreen.tsx");
    expect(SCREEN).toContain("{o.loadingAddress && (");
    expect(SCREEN).toContain("{o.deliveryAddress && (");
    expect(SCREEN).toContain('typeof o.weightKg === "number"');
    expect(SCREEN).toContain("kg");
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
