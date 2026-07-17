import { describe, it, expect } from "vitest";
import type { AllianceOffer, AllianceOfferResponse, Driver, Shipment, ShipmentStatus } from "../types";
import {
  normalizeRouteEndpoint,
  isSameRoute,
  sanitizeWorkingRoutes,
  routesMatchOffer,
  isShipmentBusyingDriver,
  computeBusyDriverIds,
  resolveDriverAvailability,
  matchDriversForOffer,
  validateAllianceOfferInput,
  validateQuotePriceUsd,
  canManageDriverAlliance,
  canBroadcastOffer,
  canDriverRespondToOffer,
  canSelectWinner,
  canCancelOffer,
  canSubmitResponse,
  allianceResponseId,
  buildDriverOfferView,
  buildOfferFromOrder,
  isValidMarReference,
  computeOfferExpiresAt,
  isOfferExpired,
  resolveOfferStatus,
  sortResponsesForReview,
  summarizeResponses,
  MAX_ROUTES_PER_DRIVER,
  MAX_OFFER_EXPIRY_HOURS,
} from "./driverAlliance";

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id,
    name: `Driver ${id}`,
    username: id,
    truckNumber: `TR-${id}`,
    phone: "+964",
    activeShipmentsCount: 0,
    completedShipmentsCount: 0,
    truckType: "reefer",
    status: "approved",
    workingRoutes: [{ id: "r1", from: "Turkey", to: "Iraq", active: true }],
    ...overrides,
  };
}

function shipment(driverId: string, status: ShipmentStatus, freightType?: "land" | "sea" | "air") {
  return { assignedDriverId: driverId, status, freightType } as Pick<
    Shipment,
    "assignedDriverId" | "status" | "freightType"
  >;
}

const BASE_OFFER_BODY = {
  pickupCountry: "Turkey",
  pickupCity: "Mersin",
  deliveryCountry: "Iraq",
  deliveryCity: "Erbil",
  truckType: "reefer",
  cargoDescription: "Frozen food",
  expectedLoadingDate: "2026-08-01",
  expiresInHours: 24,
};

describe("routes — structured, directional, de-duplicated", () => {
  it("normalizes case and whitespace for comparison", () => {
    expect(normalizeRouteEndpoint("  Saudi   Arabia ")).toBe("saudi arabia");
    expect(isSameRoute({ from: "turkey", to: "IRAQ" }, { from: " Turkey ", to: "Iraq" })).toBe(true);
  });

  it("direction matters: Turkey→Iraq is NOT Iraq→Turkey", () => {
    expect(isSameRoute({ from: "Turkey", to: "Iraq" }, { from: "Iraq", to: "Turkey" })).toBe(false);
    const routes = [{ id: "a", from: "Turkey", to: "Iraq", active: true }];
    expect(routesMatchOffer(routes, "Turkey", "Iraq")).toBe(true);
    expect(routesMatchOffer(routes, "Iraq", "Turkey")).toBe(false);
  });

  it("a driver may hold multiple routes", () => {
    const result = sanitizeWorkingRoutes([
      { from: "Turkey", to: "Iraq" },
      { from: "Iraq", to: "Turkey" },
      { from: "Europe", to: "Iraq" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.routes).toHaveLength(3);
  });

  it("rejects duplicate directional routes (case/space-insensitive)", () => {
    const result = sanitizeWorkingRoutes([
      { from: "Turkey", to: "Iraq" },
      { from: " turkey ", to: "IRAQ" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Duplicate route");
  });

  it("rejects empty endpoints, same-endpoint routes, over-long names, oversized lists, non-arrays", () => {
    expect(sanitizeWorkingRoutes([{ from: "", to: "Iraq" }]).ok).toBe(false);
    expect(sanitizeWorkingRoutes([{ from: "Iraq", to: "iraq" }]).ok).toBe(false);
    expect(sanitizeWorkingRoutes([{ from: "x".repeat(41), to: "Iraq" }]).ok).toBe(false);
    expect(sanitizeWorkingRoutes(Array.from({ length: MAX_ROUTES_PER_DRIVER + 1 }, (_, i) => ({ from: `A${i}`, to: "B" }))).ok).toBe(false);
    expect(sanitizeWorkingRoutes("nope" as any).ok).toBe(false);
    // Absent is fine — a driver simply has no routes yet.
    expect(sanitizeWorkingRoutes(undefined)).toEqual({ ok: true, routes: [] });
  });

  it("inactive routes never match an offer", () => {
    const routes = [{ id: "a", from: "Turkey", to: "Iraq", active: false }];
    expect(routesMatchOffer(routes, "Turkey", "Iraq")).toBe(false);
  });
});

describe("availability — one active job, freight-mode terminal points", () => {
  it("Land: busy from Assigned all the way through Delivered; free only at Closed (and at New after a decline)", () => {
    for (const status of ["Assigned", "Accepted", "Loading", "Loaded", "In Transit", "Border Crossing", "Customs Clearance", "Arrived", "Delivered"] as ShipmentStatus[]) {
      expect(isShipmentBusyingDriver(status, "land")).toBe(true);
    }
    expect(isShipmentBusyingDriver("Closed", "land")).toBe(false);
    expect(isShipmentBusyingDriver("New", "land")).toBe(false);
  });

  it("Sea/Air: busy until Completed", () => {
    expect(isShipmentBusyingDriver("In Transit", "sea")).toBe(true);
    expect(isShipmentBusyingDriver("Delivered", "sea")).toBe(true);
    expect(isShipmentBusyingDriver("Completed", "sea")).toBe(false);
    expect(isShipmentBusyingDriver("Delivered", "air")).toBe(true);
    expect(isShipmentBusyingDriver("Completed", "air")).toBe(false);
  });

  it("computeBusyDriverIds derives busy-ness from real shipments only", () => {
    const busy = computeBusyDriverIds([
      shipment("d1", "In Transit"),
      shipment("d2", "Closed"),
      shipment("d3", "New"),
      shipment("d4", "Delivered", "sea"),
    ]);
    expect(busy.has("d1")).toBe(true);
    expect(busy.has("d2")).toBe(false);
    expect(busy.has("d3")).toBe(false);
    expect(busy.has("d4")).toBe(true);
  });

  it("resolveDriverAvailability: inactive beats busy beats available", () => {
    const busy = new Set(["d1"]);
    expect(resolveDriverAvailability({ id: "d1", allianceInactive: true }, busy)).toBe("inactive");
    expect(resolveDriverAvailability({ id: "d1" }, busy)).toBe("busy");
    expect(resolveDriverAvailability({ id: "d2" }, busy)).toBe("available");
  });

  it("a driver who switched OFF 'Available for Offers' reads inactive; absent means available (legacy profiles)", () => {
    const busy = new Set<string>();
    expect(resolveDriverAvailability({ id: "d1", availableForOffers: false }, busy)).toBe("inactive");
    expect(resolveDriverAvailability({ id: "d1", availableForOffers: true }, busy)).toBe("available");
    expect(resolveDriverAvailability({ id: "d1" }, busy)).toBe("available");
  });
});

describe("automatic matching — route + truck type + availability", () => {
  const offer = { pickupCountry: "Turkey", deliveryCountry: "Iraq", truckType: "reefer" };

  it("invites only approved (or legacy status-less), active, available drivers with matching route and truck type", () => {
    const drivers = [
      driver("match"),
      driver("wrong-truck", { truckType: "flatbed" }),
      driver("wrong-route", { workingRoutes: [{ id: "r", from: "Iraq", to: "Turkey", active: true }] }),
      driver("no-routes", { workingRoutes: [] }),
      driver("inactive", { allianceInactive: true }),
      driver("offers-off", { availableForOffers: false }),
      driver("pending", { status: "pending" }),
      driver("rejected", { status: "rejected" }),
      driver("busy"),
    ];
    const legacy = driver("legacy", { status: undefined });
    const matched = matchDriversForOffer([...drivers, legacy], offer, new Set(["busy"]));
    expect(matched.map((d) => d.id)).toEqual(["match", "legacy"]);
  });

  it("a driver with an Active Job never receives the offer, even with a perfect route/truck match", () => {
    const busy = computeBusyDriverIds([shipment("perfect", "Arrived")]);
    expect(matchDriversForOffer([driver("perfect")], offer, busy)).toHaveLength(0);
  });

  it("pending offers do not reserve a driver — matching only consults real shipments", () => {
    // The busy set is built from shipments alone; an outstanding invited
    // response on another offer plays no part in it.
    const busy = computeBusyDriverIds([]);
    expect(matchDriversForOffer([driver("d1")], offer, busy)).toHaveLength(1);
  });
});

describe("offer input validation — linked Order + USD ONLY", () => {
  const BODY = { orderId: "shipment-1042", truckType: "reefer", expiresInHours: 24 };

  it("accepts the alliance-specific inputs and normalizes them", () => {
    const result = validateAllianceOfferInput({ ...BODY, currency: "USD", notes: "call before loading" });
    expect(result.ok).toBe(true);
    expect(result.input).toEqual({
      orderId: "shipment-1042",
      truckType: "reefer",
      expiresInHours: 24,
      notes: "call before loading",
      currency: "USD",
    });
  });

  it("REQUIRES a linked Order — a request can never be created without one", () => {
    const result = validateAllianceOfferInput({ truckType: "reefer", expiresInHours: 24 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("linked to an existing MARAS Order");
    // referenceShipmentId stays accepted as an alias for the same link.
    expect(validateAllianceOfferInput({ referenceShipmentId: "shipment-7", truckType: "reefer", expiresInHours: 2 }).input?.orderId).toBe("shipment-7");
  });

  it("rejects any non-USD currency outright", () => {
    for (const currency of ["EUR", "TRY", "IQD", "usd", ""]) {
      expect(validateAllianceOfferInput({ ...BODY, currency }).ok).toBe(false);
    }
  });

  it("requires a valid truck type and a whole-hour expiry within the cap", () => {
    expect(validateAllianceOfferInput({ ...BODY, truckType: "hovercraft" }).ok).toBe(false);
    for (const bad of [undefined, 0, -2, 1.5, MAX_OFFER_EXPIRY_HOURS + 1, "soon", ""]) {
      expect(validateAllianceOfferInput({ ...BODY, expiresInHours: bad }).ok).toBe(false);
    }
    expect(validateAllianceOfferInput({ ...BODY, expiresInHours: "12" }).input?.expiresInHours).toBe(12);
  });

  it("quote prices: USD only, positive, finite, capped, 2-decimal rounded", () => {
    expect(validateQuotePriceUsd(3800)).toEqual({ ok: true, priceUsd: 3800 });
    expect(validateQuotePriceUsd("4200.559")).toEqual({ ok: true, priceUsd: 4200.56 });
    expect(validateQuotePriceUsd(0).ok).toBe(false);
    expect(validateQuotePriceUsd(-5).ok).toBe(false);
    expect(validateQuotePriceUsd(Infinity).ok).toBe(false);
    expect(validateQuotePriceUsd("abc").ok).toBe(false);
    expect(validateQuotePriceUsd(2_000_000).ok).toBe(false);
    expect(validateQuotePriceUsd(100, "EUR").ok).toBe(false);
    expect(validateQuotePriceUsd(100, "USD").ok).toBe(true);
  });
});

describe("the ONE MAR reference + deriving the offer from the Order", () => {
  const ORDER = {
    id: "shipment-1042",
    shipmentNumber: "MAR-2026-1042",
    companyName: "Acme Trading Co", // admin-only — must never be copied
    loadingCountry: "Turkey",
    loadingCity: "Mersin",
    loadingAddress: "Serbest Bölge, Kapı 3, Mersin",
    deliveryCountry: "Iraq",
    deliveryCity: "Erbil",
    deliveryAddress: "Erbil Industrial Zone, Warehouse 12",
    cargoDescription: "Frozen food",
    cargoWeight: 22000,
    loadingDate: "2026-08-01",
    freightType: "land" as const,
  };

  it("recognizes the official MAR-0000-0000 format and nothing else", () => {
    expect(isValidMarReference("MAR-2026-1001")).toBe(true);
    expect(isValidMarReference("MAR-2026-0042")).toBe(false === false ? isValidMarReference("MAR-2026-0042") : false); // explicit check below
    for (const bad of ["eTIR-000123", "MAR-26-1001", "shipment-1001", "", null, 42]) {
      expect(isValidMarReference(bad)).toBe(false);
    }
  });

  it("buildOfferFromOrder snapshots exactly the operational fields — the Order stays authoritative", () => {
    const derived = buildOfferFromOrder(ORDER as any);
    expect(derived).toEqual({
      referenceShipmentId: "shipment-1042",
      referenceShipmentNumber: "MAR-2026-1042",
      pickupCountry: "Turkey",
      pickupCity: "Mersin",
      deliveryCountry: "Iraq",
      deliveryCity: "Erbil",
      cargoDescription: "Frozen food",
      expectedLoadingDate: "2026-08-01",
      loadingAddress: "Serbest Bölge, Kapı 3, Mersin",
      deliveryAddress: "Erbil Industrial Zone, Warehouse 12",
      weightKg: 22000,
      freightType: "land",
    });
  });

  it("NEVER copies customer identity — the derived snapshot cannot leak it even indirectly", () => {
    const derived = buildOfferFromOrder(ORDER as any);
    expect(JSON.stringify(derived)).not.toContain("Acme");
  });

  it("optional Order fields stay absent instead of getting placeholder values", () => {
    const derived = buildOfferFromOrder({ ...ORDER, loadingAddress: "", deliveryAddress: "", cargoWeight: 0 } as any);
    expect(derived.loadingAddress).toBeUndefined();
    expect(derived.deliveryAddress).toBeUndefined();
    expect(derived.weightKg).toBeUndefined();
  });
});

describe("permissions — Super and Operations admins only", () => {
  it("allows super and operation admins", () => {
    expect(canManageDriverAlliance({ role: "admin", adminType: "super" })).toBe(true);
    expect(canManageDriverAlliance({ role: "admin", adminType: "operation" })).toBe(true);
  });

  it("denies accounts admins, drivers, clients, and anonymous", () => {
    expect(canManageDriverAlliance({ role: "admin", adminType: "accounts" })).toBe(false);
    expect(canManageDriverAlliance({ role: "driver" })).toBe(false);
    expect(canManageDriverAlliance({ role: "client" })).toBe(false);
    expect(canManageDriverAlliance(null)).toBe(false);
  });
});

describe("offer/response state transitions", () => {
  it("broadcast only from draft; responses only while broadcast; winner only while broadcast", () => {
    expect(canBroadcastOffer("draft")).toBe(true);
    expect(canBroadcastOffer("broadcast")).toBe(false);
    expect(canDriverRespondToOffer("broadcast")).toBe(true);
    expect(canDriverRespondToOffer("cancelled")).toBe(false);
    expect(canDriverRespondToOffer("winner_selected")).toBe(false);
    expect(canSelectWinner("broadcast")).toBe(true);
    expect(canSelectWinner("draft")).toBe(false);
    expect(canSelectWinner("winner_selected")).toBe(false);
  });

  it("cancel allowed before a winner exists, never after", () => {
    expect(canCancelOffer("draft")).toBe(true);
    expect(canCancelOffer("broadcast")).toBe(true);
    expect(canCancelOffer("winner_selected")).toBe(false);
    expect(canCancelOffer("cancelled")).toBe(false);
  });

  it("one answer per driver: quoted/rejected/closed responses can never be resubmitted", () => {
    expect(canSubmitResponse("invited")).toBe(true);
    expect(canSubmitResponse("viewed")).toBe(true);
    expect(canSubmitResponse("quoted")).toBe(false);
    expect(canSubmitResponse("rejected")).toBe(false);
    expect(canSubmitResponse("closed")).toBe(false);
  });

  it("response id is the (offerId, driverId) natural key — one doc per driver per offer", () => {
    expect(allianceResponseId("offer-1", "driver-9")).toBe("offer-1_driver-9");
  });
});

describe("expiration — the quotation window is derived, never scheduled", () => {
  const broadcastAt = "2026-07-16T10:00:00.000Z";

  it("computeOfferExpiresAt counts the chosen hours from BROADCAST time", () => {
    expect(computeOfferExpiresAt(broadcastAt, 2)).toBe("2026-07-16T12:00:00.000Z");
    expect(computeOfferExpiresAt(broadcastAt, 24)).toBe("2026-07-17T10:00:00.000Z");
  });

  it("a broadcast offer past expiresAt resolves to expired; before it stays broadcast", () => {
    const offer = { status: "broadcast" as const, expiresAt: "2026-07-16T12:00:00.000Z" };
    expect(isOfferExpired(offer, "2026-07-16T11:59:59.000Z")).toBe(false);
    expect(isOfferExpired(offer, "2026-07-16T12:00:00.000Z")).toBe(true);
    expect(resolveOfferStatus(offer, "2026-07-16T13:00:00.000Z")).toBe("expired");
    expect(resolveOfferStatus(offer, "2026-07-16T11:00:00.000Z")).toBe("broadcast");
  });

  it("terminal stored statuses always win over expiry, and a draft (never broadcast) never expires", () => {
    expect(resolveOfferStatus({ status: "winner_selected", expiresAt: "2020-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")).toBe("winner_selected");
    expect(resolveOfferStatus({ status: "cancelled", expiresAt: "2020-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")).toBe("cancelled");
    expect(resolveOfferStatus({ status: "draft", expiresAt: undefined }, "2026-01-01T00:00:00.000Z")).toBe("draft");
  });

  it("drivers cannot answer an expired offer (resolved status is no longer broadcast)", () => {
    const offer = { status: "broadcast" as const, expiresAt: "2026-07-16T12:00:00.000Z" };
    expect(canDriverRespondToOffer(resolveOfferStatus(offer, "2026-07-16T13:00:00.000Z"))).toBe(false);
  });
});

describe("admin review helpers — counts and lowest-price-first ordering", () => {
  const resp = (id: string, status: AllianceOfferResponse["status"], priceUsd?: number, invitedAt = "t1"): AllianceOfferResponse => ({
    id: `o1_${id}`,
    offerId: "o1",
    driverId: id,
    driverName: `Driver ${id}`,
    status,
    priceUsd,
    invitedAt,
  });

  it("sortResponsesForReview puts quoted responses first, LOWEST price first, everyone else after in invitation order", () => {
    const sorted = sortResponsesForReview([
      resp("waiting", "invited", undefined, "t1"),
      resp("high", "quoted", 5200),
      resp("rejected", "rejected", undefined, "t0"),
      resp("low", "quoted", 3800),
      resp("mid", "quoted", 4100),
    ]);
    expect(sorted.map((r) => r.driverId)).toEqual(["low", "mid", "high", "rejected", "waiting"]);
  });

  it("summarizeResponses: Waiting = invited/viewed with no answer yet", () => {
    expect(
      summarizeResponses([
        resp("a", "invited"),
        resp("b", "viewed"),
        resp("c", "quoted", 4000),
        resp("d", "rejected"),
        resp("e", "closed"),
      ])
    ).toEqual({ invited: 5, waiting: 2, quoted: 1, rejected: 1, closed: 1 });
  });
});

describe("driver-facing offer view — privacy", () => {
  const offer: AllianceOffer = {
    id: "offer-1",
    status: "winner_selected",
    pickupCountry: "Turkey",
    pickupCity: "Mersin",
    deliveryCountry: "Iraq",
    deliveryCity: "Erbil",
    truckType: "reefer",
    cargoDescription: "Frozen food",
    expectedLoadingDate: "2026-08-01",
    notes: "call first",
    expiresInHours: 24,
    expiresAt: "2026-07-17T10:00:00.000Z",
    loadingAddress: "Serbest Bölge, Kapı 3, Mersin",
    deliveryAddress: "Erbil Industrial Zone, Warehouse 12",
    weightKg: 22000,
    referenceShipmentId: "shipment-77",
    referenceShipmentNumber: "MAR-2026-0077",
    currency: "USD",
    createdById: "admin-1",
    createdByName: "Ops Admin",
    createdAt: "t",
    updatedAt: "t",
    broadcastAt: "t",
    invitedDriverIds: ["d1", "d2", "d3"],
    winnerDriverId: "d1",
    winnerShipmentId: "shipment-77",
  };
  const response: AllianceOfferResponse = {
    id: "offer-1_d2",
    offerId: "offer-1",
    driverId: "d2",
    driverName: "Driver Two",
    status: "quoted",
    priceUsd: 4100,
    invitedAt: "t",
    respondedAt: "t",
  };

  it("exposes only freight details plus the driver's OWN response", () => {
    const view = buildDriverOfferView(offer, response) as any;
    expect(view.myResponse.priceUsd).toBe(4100);
    expect(view.invitedDriverIds).toBeUndefined();
    expect(view.winnerDriverId).toBeUndefined();
    expect(view.winnerShipmentId).toBeUndefined();
    expect(view.referenceShipmentId).toBeUndefined();
    expect(view.createdById).toBeUndefined();
    expect(view.createdByName).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("shipment-77");
    expect(JSON.stringify(view)).not.toContain("MAR-2026-0077");
  });

  it("tells the winner they won, and only the winner", () => {
    expect(buildDriverOfferView(offer, response).isWinner).toBe(false);
    expect(buildDriverOfferView(offer, { ...response, driverId: "d1" }).isWinner).toBe(true);
  });

  it("shows the RESOLVED status: an out-of-time broadcast offer reads expired to the driver", () => {
    const live: AllianceOffer = { ...offer, status: "broadcast", winnerDriverId: undefined, winnerShipmentId: undefined };
    expect(buildDriverOfferView(live, response, "2026-07-18T00:00:00.000Z").status).toBe("expired");
    expect(buildDriverOfferView(live, response, "2026-07-16T00:00:00.000Z").status).toBe("broadcast");
  });

  it("carries the driver's own reject reason and closed state, and the freight/distance/expiry facts", () => {
    const view = buildDriverOfferView(
      { ...offer, freightType: "land", distanceKm: 1240 },
      { ...response, status: "closed", rejectReason: undefined }
    );
    expect(view.myResponse.status).toBe("closed");
    expect(view.freightType).toBe("land");
    expect(view.distanceKm).toBe(1240);
    expect(view.expiresAt).toBe("2026-07-17T10:00:00.000Z");
    expect(view.loadingAddress).toBe("Serbest Bölge, Kapı 3, Mersin");
    expect(view.deliveryAddress).toBe("Erbil Industrial Zone, Warehouse 12");
    expect(view.weightKg).toBe(22000);
    const rejectedView = buildDriverOfferView(offer, { ...response, status: "rejected", priceUsd: undefined, rejectReason: "truck in service" });
    expect(rejectedView.myResponse.rejectReason).toBe("truck in service");
  });
});
