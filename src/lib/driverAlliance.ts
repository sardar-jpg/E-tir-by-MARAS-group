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

/**
 * Inactive wins over Busy: a driver switched off (by Operations via
 * allianceInactive, or by the driver themselves via the app's
 * "Available for Offers" switch — availableForOffers === false) never
 * appears available regardless of workload. availableForOffers is the
 * one alliance field the DRIVER controls; absent means available, the
 * same legacy-friendly convention as isDriverApproved.
 */
export function resolveDriverAvailability(
  driver: Pick<Driver, "id" | "allianceInactive" | "availableForOffers">,
  busyDriverIds: Set<string>
): DriverAvailability {
  if (driver.allianceInactive || driver.availableForOffers === false) return "inactive";
  if (busyDriverIds.has(driver.id)) return "busy";
  return "available";
}

// ── Matching ────────────────────────────────────────────────────────

/**
 * Automatic driver matching for a broadcast: matching directional route,
 * matching truck type, Available status. Drivers with an Active Job,
 * alliance-inactive drivers, drivers who switched OFF "Available for
 * Offers" in the app, and unapproved (pending/rejected) drivers are
 * never invited.
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
      d.availableForOffers !== false &&
      !busyDriverIds.has(d.id) &&
      (d.truckType || "") === offer.truckType &&
      routesMatchOffer(d.workingRoutes, offer.pickupCountry, offer.deliveryCountry)
  );
}

// ── MAR reference (the ONE operational number) ──────────────────────

/**
 * The single official operational reference format used everywhere in
 * the system: MAR-<year>-<number> (formatShipmentNumber,
 * shipmentNumbering.ts — e.g. MAR-2026-1042). Every alliance quote
 * request must link to an Order carrying a valid MAR reference; the
 * alliance never mints any number of its own.
 */
export const MAR_REFERENCE_PATTERN = /^MAR-\d{4}-\d{4,}$/;

export function isValidMarReference(value: unknown): value is string {
  return typeof value === "string" && MAR_REFERENCE_PATTERN.test(value.trim());
}

// ── Offer validation (USD ONLY) ─────────────────────────────────────

export const MAX_OFFER_TEXT_LENGTH = 500;
export const MAX_QUOTE_PRICE_USD = 1_000_000;

/** Quick-pick expiry windows Operations chooses from (hours). */
export const OFFER_EXPIRY_HOURS_OPTIONS = [2, 12, 24] as const;
export const MAX_OFFER_EXPIRY_HOURS = 72;
export const OFFER_FREIGHT_TYPES = ["land", "sea", "air"] as const;
export const MAX_OFFER_DISTANCE_KM = 50_000;

export interface OfferInputResult {
  ok: boolean;
  error?: string;
  /**
   * Alliance-SPECIFIC inputs only. Everything operational (route,
   * addresses, cargo, weight, loading date) comes from the linked Order
   * via buildOfferFromOrder below — the Order is the source of truth,
   * and an alliance request can never exist without one.
   */
  input?: {
    orderId: string;
    truckType: string;
    expiresInHours: number;
    notes?: string;
    currency: "USD";
  };
}

/**
 * Validates an offer-creation body: the linked Order id plus the
 * alliance-specific settings ONLY. USD-only by design: a request naming
 * any other currency is rejected outright rather than coerced.
 */
export function validateAllianceOfferInput(body: any): OfferInputResult {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // orderId is the request-body name for the Order link (stored as
  // referenceShipmentId); referenceShipmentId is accepted as an alias
  // for backward compatibility with earlier callers.
  const orderId = text(body?.orderId) || text(body?.referenceShipmentId);
  const truckType = text(body?.truckType);
  const notes = text(body?.notes);

  if (body?.currency !== undefined && body.currency !== "USD") {
    return { ok: false, error: "Driver Alliance offers are USD only." };
  }
  if (!orderId) {
    return { ok: false, error: "A quote request must be linked to an existing MARAS Order. Select or create the Order first." };
  }
  if (!TRUCK_TYPES.some((t) => t.id === truckType)) return { ok: false, error: "A valid truck type is required." };
  if (notes.length > MAX_OFFER_TEXT_LENGTH) {
    return { ok: false, error: `Notes are limited to ${MAX_OFFER_TEXT_LENGTH} characters.` };
  }
  const expiresInHoursRaw = body?.expiresInHours;
  const expiresInHours =
    typeof expiresInHoursRaw === "number"
      ? expiresInHoursRaw
      : typeof expiresInHoursRaw === "string" && expiresInHoursRaw.trim() !== ""
      ? Number(expiresInHoursRaw)
      : NaN;
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > MAX_OFFER_EXPIRY_HOURS) {
    return { ok: false, error: `An offer expiry between 1 and ${MAX_OFFER_EXPIRY_HOURS} hours is required (e.g. 2, 12, or 24).` };
  }

  return {
    ok: true,
    input: {
      orderId,
      truckType,
      expiresInHours,
      notes: notes || undefined,
      currency: "USD",
    },
  };
}

/**
 * Derives every operational offer field from the linked Order (the
 * Shipment record). These are SNAPSHOTS for historical accuracy — the
 * Order is always the authoritative value, and the MAR reference
 * (order.shipmentNumber) is the one user-visible operational number for
 * the entire lifecycle. Customer identity (companyName, contact
 * numbers) is deliberately never copied: nothing here can leak it to a
 * driver even indirectly.
 */
export function buildOfferFromOrder(
  order: Pick<
    Shipment,
    | "id"
    | "shipmentNumber"
    | "loadingCountry"
    | "loadingCity"
    | "loadingAddress"
    | "deliveryCountry"
    | "deliveryCity"
    | "deliveryAddress"
    | "cargoDescription"
    | "cargoWeight"
    | "loadingDate"
    | "freightType"
  >
): Pick<
  AllianceOffer,
  | "referenceShipmentId"
  | "referenceShipmentNumber"
  | "pickupCountry"
  | "pickupCity"
  | "deliveryCountry"
  | "deliveryCity"
  | "cargoDescription"
  | "expectedLoadingDate"
  | "loadingAddress"
  | "deliveryAddress"
  | "weightKg"
  | "freightType"
> {
  return {
    referenceShipmentId: order.id,
    referenceShipmentNumber: order.shipmentNumber,
    pickupCountry: order.loadingCountry || "",
    pickupCity: order.loadingCity || "",
    deliveryCountry: order.deliveryCountry || "",
    deliveryCity: order.deliveryCity || "",
    cargoDescription: order.cargoDescription || "",
    expectedLoadingDate: order.loadingDate || "",
    loadingAddress: order.loadingAddress || undefined,
    deliveryAddress: order.deliveryAddress || undefined,
    // Kilograms — the project's existing convention (Shipment.cargoWeight "in kg").
    weightKg: typeof order.cargoWeight === "number" && order.cargoWeight > 0 ? order.cargoWeight : undefined,
    freightType: order.freightType || "land",
  };
}

// ── Expiry ──────────────────────────────────────────────────────────

/** The absolute expiry instant: the window starts at BROADCAST time. */
export function computeOfferExpiresAt(broadcastAtIso: string, expiresInHours: number): string {
  return new Date(new Date(broadcastAtIso).getTime() + expiresInHours * 3_600_000).toISOString();
}

/** Whether the quotation window has closed on a live (broadcast) offer. */
export function isOfferExpired(
  offer: Pick<AllianceOffer, "status" | "expiresAt">,
  nowIso: string = new Date().toISOString()
): boolean {
  return offer.status === "broadcast" && !!offer.expiresAt && offer.expiresAt <= nowIso;
}

/**
 * The status callers should DISPLAY and gate driver answers on. Expiry
 * is derived, never stored (no scheduler, no migration): a stored
 * 'broadcast' offer past its expiresAt resolves to 'expired'. Terminal
 * stored statuses (winner_selected / cancelled) always win.
 */
export function resolveOfferStatus(
  offer: Pick<AllianceOffer, "status" | "expiresAt">,
  nowIso: string = new Date().toISOString()
): AllianceOfferStatus {
  return isOfferExpired(offer, nowIso) ? "expired" : offer.status;
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

// ── Admin review helpers ────────────────────────────────────────────

/**
 * Review ordering for the admin quotations table: quoted responses
 * first, LOWEST price first; everything else after, in invitation
 * order. Never mutates the input.
 */
export function sortResponsesForReview(responses: AllianceOfferResponse[]): AllianceOfferResponse[] {
  return [...responses].sort((a, b) => {
    const aQuoted = a.status === "quoted" && typeof a.priceUsd === "number";
    const bQuoted = b.status === "quoted" && typeof b.priceUsd === "number";
    if (aQuoted && bQuoted) return a.priceUsd! - b.priceUsd!;
    if (aQuoted !== bQuoted) return aQuoted ? -1 : 1;
    return (a.invitedAt || "").localeCompare(b.invitedAt || "");
  });
}

export interface OfferResponseSummary {
  invited: number;
  waiting: number;
  quoted: number;
  rejected: number;
  closed: number;
}

/** Per-offer counts for the admin "Offer Requests" list (Waiting = invited/viewed, still no answer). */
export function summarizeResponses(responses: Array<Pick<AllianceOfferResponse, "status">>): OfferResponseSummary {
  const summary: OfferResponseSummary = { invited: responses.length, waiting: 0, quoted: 0, rejected: 0, closed: 0 };
  for (const r of responses) {
    if (r.status === "invited" || r.status === "viewed") summary.waiting += 1;
    else if (r.status === "quoted") summary.quoted += 1;
    else if (r.status === "rejected") summary.rejected += 1;
    else if (r.status === "closed") summary.closed += 1;
  }
  return summary;
}

// ── Driver-facing sanitized view ────────────────────────────────────

export interface DriverOfferView {
  id: string;
  /** RESOLVED status — a past-expiry broadcast offer reads 'expired' here. */
  status: AllianceOfferStatus;
  pickupCountry: string;
  pickupCity: string;
  deliveryCountry: string;
  deliveryCity: string;
  truckType: string;
  cargoDescription: string;
  expectedLoadingDate: string;
  notes?: string;
  freightType?: string;
  distanceKm?: number;
  loadingAddress?: string;
  deliveryAddress?: string;
  /** Kilograms (Shipment.cargoWeight convention). */
  weightKg?: number;
  expiresAt?: string;
  currency: "USD";
  broadcastAt?: string;
  /** This driver's OWN response only. */
  myResponse: {
    status: AllianceOfferResponse["status"];
    priceUsd?: number;
    note?: string;
    rejectReason?: string;
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
 * creating admin's identity. A response closed because Operations
 * selected someone else surfaces only as myResponse.status === "closed"
 * — the winner's identity stays hidden.
 */
export function buildDriverOfferView(
  offer: AllianceOffer,
  ownResponse: AllianceOfferResponse,
  nowIso: string = new Date().toISOString()
): DriverOfferView {
  return {
    id: offer.id,
    status: resolveOfferStatus(offer, nowIso),
    pickupCountry: offer.pickupCountry,
    pickupCity: offer.pickupCity,
    deliveryCountry: offer.deliveryCountry,
    deliveryCity: offer.deliveryCity,
    truckType: offer.truckType,
    cargoDescription: offer.cargoDescription,
    expectedLoadingDate: offer.expectedLoadingDate,
    notes: offer.notes,
    freightType: offer.freightType,
    distanceKm: offer.distanceKm,
    loadingAddress: offer.loadingAddress,
    deliveryAddress: offer.deliveryAddress,
    weightKg: offer.weightKg,
    expiresAt: offer.expiresAt,
    currency: "USD",
    broadcastAt: offer.broadcastAt,
    myResponse: {
      status: ownResponse.status,
      priceUsd: ownResponse.priceUsd,
      note: ownResponse.note,
      rejectReason: ownResponse.rejectReason,
      respondedAt: ownResponse.respondedAt,
    },
    isWinner: offer.status === "winner_selected" && offer.winnerDriverId === ownResponse.driverId,
  };
}
