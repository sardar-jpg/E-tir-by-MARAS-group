/**
 * driverAlliance.ts — Driver Alliance Phase 1 pure decision logic.
 *
 * The single source of truth for every alliance rule that both the
 * server (authoritative enforcement, server.ts /api/alliance routes and
 * the one-active-job assignment gate) and the Admin/Driver UIs share:
 *
 *  - directional working routes (normalize, dedupe, sanitize, match),
 *  - driver availability (Available / Busy / Inactive) — Busy is derived
 *    from real shipments only: a driver becomes Busy at assignment and
 *    stays Busy until the shipment's freight-mode closing status (Closed
 *    for Land, Completed for Sea/Air). Pending offers never reserve a
 *    driver.
 *  - automatic driver matching (route + truck type + availability),
 *  - offer input validation (USD ONLY) and quote price validation,
 *  - offer/response state transitions,
 *  - the super/operation-only permission rule,
 *  - the driver-facing sanitized offer view (an invited driver never
 *    sees other drivers' identities, prices, or internal references).
 *
 * Pure functions, no I/O — unit-tested in driverAlliance.test.ts. Status
 * sequences are never re-encoded here; busy-ness derives from the
 * existing shipmentStatusTransitions helpers, so alliance availability
 * can never drift from the real shipment workflow.
 */
import type {
  AllianceOffer,
  AllianceOfferResponse,
  AllianceOfferStatus,
  Driver,
  DriverRoute,
  Shipment,
  ShipmentStatus,
} from "../types";
import { TRUCK_TYPES } from "../types";
import {
  getStatusSequenceForFreightMode,
  isShipmentClosed,
  resolveFreightMode,
} from "./shipmentStatusTransitions";
import { isDriverApproved } from "./driverAccess";

// ── Routes ──────────────────────────────────────────────────────────

export const MAX_ROUTES_PER_DRIVER = 20;
export const MAX_ROUTE_ENDPOINT_LENGTH = 40;

/** Case/whitespace-insensitive comparison key for a route endpoint. */
export function normalizeRouteEndpoint(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Directional equality: from→to must match from→to. */
export function isSameRoute(a: Pick<DriverRoute, "from" | "to">, b: Pick<DriverRoute, "from" | "to">): boolean {
  return (
    normalizeRouteEndpoint(a.from) === normalizeRouteEndpoint(b.from) &&
    normalizeRouteEndpoint(a.to) === normalizeRouteEndpoint(b.to)
  );
}

export interface RouteSanitizeResult {
  ok: boolean;
  routes: DriverRoute[];
  error?: string;
}

/**
 * Validates and normalizes a client-submitted workingRoutes array into
 * safe, structured, de-duplicated route records. Rejects (never silently
 * fixes) empty endpoints, identical from/to, over-long values, and
 * duplicate directional routes — the admin should see why a save failed
 * rather than wonder where a route went.
 */
export function sanitizeWorkingRoutes(input: unknown): RouteSanitizeResult {
  if (input === undefined || input === null) return { ok: true, routes: [] };
  if (!Array.isArray(input)) return { ok: false, routes: [], error: "workingRoutes must be an array." };
  if (input.length > MAX_ROUTES_PER_DRIVER) {
    return { ok: false, routes: [], error: `A driver can have at most ${MAX_ROUTES_PER_DRIVER} routes.` };
  }
  const routes: DriverRoute[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, routes: [], error: "Each route must be an object." };
    const from = typeof (raw as any).from === "string" ? (raw as any).from.trim().replace(/\s+/g, " ") : "";
    const to = typeof (raw as any).to === "string" ? (raw as any).to.trim().replace(/\s+/g, " ") : "";
    if (!from || !to) return { ok: false, routes: [], error: "Each route needs both a from and a to." };
    if (from.length > MAX_ROUTE_ENDPOINT_LENGTH || to.length > MAX_ROUTE_ENDPOINT_LENGTH) {
      return { ok: false, routes: [], error: `Route names are limited to ${MAX_ROUTE_ENDPOINT_LENGTH} characters.` };
    }
    if (normalizeRouteEndpoint(from) === normalizeRouteEndpoint(to)) {
      return { ok: false, routes: [], error: "A route's origin and destination cannot be the same." };
    }
    if (routes.some((r) => isSameRoute(r, { from, to }))) {
      return { ok: false, routes: [], error: `Duplicate route: ${from} → ${to}.` };
    }
    routes.push({
      id: typeof (raw as any).id === "string" && (raw as any).id ? (raw as any).id : `route-${routes.length}-${from}-${to}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      from,
      to,
      active: (raw as any).active !== false,
    });
  }
  return { ok: true, routes };
}

/** Whether any ACTIVE route covers pickup→delivery (directional, normalized). */
export function routesMatchOffer(
  routes: DriverRoute[] | undefined,
  pickupCountry: string,
  deliveryCountry: string
): boolean {
  if (!routes || routes.length === 0) return false;
  return routes.some(
    (r) =>
      r.active &&
      normalizeRouteEndpoint(r.from) === normalizeRouteEndpoint(pickupCountry) &&
      normalizeRouteEndpoint(r.to) === normalizeRouteEndpoint(deliveryCountry)
  );
}

// ── Availability ────────────────────────────────────────────────────

/**
 * Whether this shipment status makes its assigned driver Busy. Busy
 * starts at real assignment ("Assigned" — never "New", so a declined
 * shipment back with dispatch frees the driver) and ends ONLY at the
 * freight mode's closing status: Closed (Land) / Completed (Sea/Air).
 * Delivered is therefore still Busy — exactly the Phase 1 rule.
 */
export function isShipmentBusyingDriver(status: ShipmentStatus, freightType?: string | null): boolean {
  if (status === "New") return false;
  if (isShipmentClosed(status, freightType)) return false;
  return getStatusSequenceForFreightMode(resolveFreightMode(freightType)).includes(status);
}

/** Driver ids that currently hold an active (busying) shipment as PRIMARY driver. */
export function computeBusyDriverIds(
  shipments: Array<Pick<Shipment, "assignedDriverId" | "status" | "freightType">>
): Set<string> {
  const busy = new Set<string>();
  for (const s of shipments) {
    if (s.assignedDriverId && isShipmentBusyingDriver(s.status, s.freightType)) {
      busy.add(s.assignedDriverId);
    }
  }
  return busy;
}

export type DriverAvailability = "available" | "busy" | "inactive";

export function resolveDriverAvailability(
  driver: Pick<Driver, "id" | "allianceInactive">,
  busyDriverIds: Set<string>
): DriverAvailability {
  if (driver.allianceInactive) return "inactive";
  if (busyDriverIds.has(driver.id)) return "busy";
  return "available";
}

// ── Matching ────────────────────────────────────────────────────────

/**
 * Automatic driver matching for a broadcast: matching directional route,
 * matching truck type, Available status. Drivers with an Active Job,
 * alliance-inactive drivers, and unapproved (pending/rejected) drivers
 * are never invited.
 */
export function matchDriversForOffer(
  drivers: Driver[],
  offer: Pick<AllianceOffer, "pickupCountry" | "deliveryCountry" | "truckType">,
  busyDriverIds: Set<string>
): Driver[] {
  return drivers.filter(
    (d) =>
      // Same approval rule as every assignment path (isDriverApproved,
      // driverAccess.ts): a missing status is a pre-registration-flow
      // driver and counts as approved; pending/rejected never match.
      isDriverApproved(d) &&
      !d.allianceInactive &&
      !busyDriverIds.has(d.id) &&
      (d.truckType || "") === offer.truckType &&
      routesMatchOffer(d.workingRoutes, offer.pickupCountry, offer.deliveryCountry)
  );
}

// ── Offer validation (USD ONLY) ─────────────────────────────────────

export const MAX_OFFER_TEXT_LENGTH = 500;
export const MAX_QUOTE_PRICE_USD = 1_000_000;

export interface OfferInputResult {
  ok: boolean;
  error?: string;
  offer?: Pick<
    AllianceOffer,
    | "pickupCountry"
    | "pickupCity"
    | "deliveryCountry"
    | "deliveryCity"
    | "truckType"
    | "cargoDescription"
    | "expectedLoadingDate"
    | "notes"
    | "referenceShipmentId"
    | "currency"
  >;
}

/**
 * Validates an offer-creation body. Phase 1 is USD-only by design: a
 * request naming any other currency is rejected outright rather than
 * coerced, so a future multi-currency phase is a deliberate change, not
 * an accident.
 */
export function validateAllianceOfferInput(body: any): OfferInputResult {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const pickupCountry = text(body?.pickupCountry);
  const pickupCity = text(body?.pickupCity);
  const deliveryCountry = text(body?.deliveryCountry);
  const deliveryCity = text(body?.deliveryCity);
  const truckType = text(body?.truckType);
  const cargoDescription = text(body?.cargoDescription);
  const expectedLoadingDate = text(body?.expectedLoadingDate);
  const notes = text(body?.notes);
  const referenceShipmentId = text(body?.referenceShipmentId);

  if (body?.currency !== undefined && body.currency !== "USD") {
    return { ok: false, error: "Driver Alliance offers are USD only." };
  }
  if (!pickupCountry || !deliveryCountry) return { ok: false, error: "Pickup and delivery country are required." };
  if (!pickupCity || !deliveryCity) return { ok: false, error: "Pickup and delivery city are required." };
  if (!TRUCK_TYPES.some((t) => t.id === truckType)) return { ok: false, error: "A valid truck type is required." };
  if (!cargoDescription) return { ok: false, error: "Cargo description is required." };
  if (!expectedLoadingDate) return { ok: false, error: "Expected loading date is required." };
  for (const [label, value] of [
    ["Pickup country", pickupCountry],
    ["Pickup city", pickupCity],
    ["Delivery country", deliveryCountry],
    ["Delivery city", deliveryCity],
    ["Cargo description", cargoDescription],
    ["Notes", notes],
  ] as const) {
    if (value.length > MAX_OFFER_TEXT_LENGTH) {
      return { ok: false, error: `${label} is limited to ${MAX_OFFER_TEXT_LENGTH} characters.` };
    }
  }

  return {
    ok: true,
    offer: {
      pickupCountry,
      pickupCity,
      deliveryCountry,
      deliveryCity,
      truckType,
      cargoDescription,
      expectedLoadingDate,
      notes: notes || undefined,
      referenceShipmentId: referenceShipmentId || undefined,
      currency: "USD",
    },
  };
}

export interface QuotePriceResult {
  ok: boolean;
  error?: string;
  priceUsd?: number;
}

/** USD quote validation: finite, positive, capped, max 2 decimals kept. */
export function validateQuotePriceUsd(value: unknown, currency?: unknown): QuotePriceResult {
  if (currency !== undefined && currency !== "USD") {
    return { ok: false, error: "Quotes are USD only." };
  }
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: "A numeric USD price is required." };
  if (n <= 0) return { ok: false, error: "The price must be greater than zero." };
  if (n > MAX_QUOTE_PRICE_USD) return { ok: false, error: `The price cannot exceed ${MAX_QUOTE_PRICE_USD.toLocaleString()} USD.` };
  return { ok: true, priceUsd: Math.round(n * 100) / 100 };
}

// ── Permissions ─────────────────────────────────────────────────────

/**
 * Only Super and Operations admins may create/broadcast/cancel offers
 * and select winners. Accounts admins and every non-admin role are
 * denied. The server mirrors this via requireFullAdmin (same rule);
 * this pure form exists for UI gating and unit tests.
 */
export function canManageDriverAlliance(session: { role?: string; adminType?: string } | null | undefined): boolean {
  return !!session && session.role === "admin" && (session.adminType === "super" || session.adminType === "operation");
}

// ── State transitions ───────────────────────────────────────────────

export function canBroadcastOffer(status: AllianceOfferStatus): boolean {
  return status === "draft";
}

/** Drivers may view/quote/reject only while the offer is live. */
export function canDriverRespondToOffer(status: AllianceOfferStatus): boolean {
  return status === "broadcast";
}

export function canSelectWinner(status: AllianceOfferStatus): boolean {
  return status === "broadcast";
}

export function canCancelOffer(status: AllianceOfferStatus): boolean {
  return status === "draft" || status === "broadcast";
}

/** A response can move to quoted/rejected only from invited/viewed — one answer per driver, never overwritten. */
export function canSubmitResponse(status: AllianceOfferResponse["status"]): boolean {
  return status === "invited" || status === "viewed";
}

export function allianceResponseId(offerId: string, driverId: string): string {
  return `${offerId}_${driverId}`;
}

// ── Driver-facing sanitized view ────────────────────────────────────

export interface DriverOfferView {
  id: string;
  status: AllianceOfferStatus;
  pickupCountry: string;
  pickupCity: string;
  deliveryCountry: string;
  deliveryCity: string;
  truckType: string;
  cargoDescription: string;
  expectedLoadingDate: string;
  notes?: string;
  currency: "USD";
  broadcastAt?: string;
  /** This driver's OWN response only. */
  myResponse: {
    status: AllianceOfferResponse["status"];
    priceUsd?: number;
    note?: string;
    respondedAt?: string;
  };
  /** True only for the winning driver's own view. */
  isWinner: boolean;
}

/**
 * What an invited driver may see of an offer: the freight details plus
 * their OWN response. Never other drivers' identities/prices/notes,
 * never invitedDriverIds, never the internal reference shipment, never
 * who won (beyond "you won" for the winner themselves), and never the
 * creating admin's identity.
 */
export function buildDriverOfferView(offer: AllianceOffer, ownResponse: AllianceOfferResponse): DriverOfferView {
  return {
    id: offer.id,
    status: offer.status,
    pickupCountry: offer.pickupCountry,
    pickupCity: offer.pickupCity,
    deliveryCountry: offer.deliveryCountry,
    deliveryCity: offer.deliveryCity,
    truckType: offer.truckType,
    cargoDescription: offer.cargoDescription,
    expectedLoadingDate: offer.expectedLoadingDate,
    notes: offer.notes,
    currency: "USD",
    broadcastAt: offer.broadcastAt,
    myResponse: {
      status: ownResponse.status,
      priceUsd: ownResponse.priceUsd,
      note: ownResponse.note,
      respondedAt: ownResponse.respondedAt,
    },
    isWinner: offer.status === "winner_selected" && offer.winnerDriverId === ownResponse.driverId,
  };
}
