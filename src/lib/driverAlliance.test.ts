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
  MAX_ROUTES_PER_DRIVER,
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

describe("offer input validation — USD ONLY", () => {
  it("accepts a complete USD offer", () => {
    const result = validateAllianceOfferInput({ ...BASE_OFFER_BODY, currency: "USD", notes: "call before loading" });
    expect(result.ok).toBe(true);
    expect(result.offer?.currency).toBe("USD");
  });

  it("rejects any non-USD currency outright", () => {
    for (const currency of ["EUR", "TRY", "IQD", "usd", ""]) {
      expect(validateAllianceOfferInput({ ...BASE_OFFER_BODY, currency }).ok).toBe(false);
    }
  });

  it("requires countries, cities, valid truck type, cargo description, and loading date", () => {
    for (const missing of ["pickupCountry", "pickupCity", "deliveryCountry", "deliveryCity", "cargoDescription", "expectedLoadingDate"]) {
      expect(validateAllianceOfferInput({ ...BASE_OFFER_BODY, [missing]: "" }).ok).toBe(false);
    }
    expect(validateAllianceOfferInput({ ...BASE_OFFER_BODY, truckType: "hovercraft" }).ok).toBe(false);
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

  it("one answer per driver: quoted/rejected responses can never be resubmitted", () => {
    expect(canSubmitResponse("invited")).toBe(true);
    expect(canSubmitResponse("viewed")).toBe(true);
    expect(canSubmitResponse("quoted")).toBe(false);
    expect(canSubmitResponse("rejected")).toBe(false);
  });

  it("response id is the (offerId, driverId) natural key — one doc per driver per offer", () => {
    expect(allianceResponseId("offer-1", "driver-9")).toBe("offer-1_driver-9");
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
    referenceShipmentId: "shipment-77",
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
  });

  it("tells the winner they won, and only the winner", () => {
    expect(buildDriverOfferView(offer, response).isWinner).toBe(false);
    expect(buildDriverOfferView(offer, { ...response, driverId: "d1" }).isWinner).toBe(true);
  });
});
