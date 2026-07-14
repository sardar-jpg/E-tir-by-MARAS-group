/**
 * shipmentListAccess.ts
 *
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * The role-scoping decision GET /api/shipments (server.ts) makes before
 * ever touching Firestore — extracted as a pure function so it's unit
 * testable without booting the server, same rationale as
 * shipmentView.ts/driverVisibility.ts/clientAccess.ts. Deliberately does
 * NOT decide what the response looks like (buildShipmentViewForRole
 * already owns per-item field redaction) — only which Firestore query
 * scopes the caller's session is allowed to read from at all.
 *
 * - admin: no filter — sees every shipment (matches the pre-existing
 *   "Admins see everything" GET /api/shipments behavior this replaces;
 *   the route's own canViewShipmentRegistry check happens before this is
 *   ever called, so an accounts-type admin never reaches here).
 * - driver: buildDriverOwnedShipmentQueryScopes (driverVisibility.ts) —
 *   assignedDriverId OR additionalDriverIds array-contains, each its own
 *   independent scope (OR-via-independent-queries, same pattern as the
 *   notification ownership lookup). Carries that function's own
 *   documented legacy-record caveat: a shipment written before
 *   additionalDriverIds existed won't match for a driver who is ONLY an
 *   additional driver on it (see driverVisibility.ts's header comment).
 * - client: buildClientOwnedShipmentQueryScopes (clientAccess.ts) —
 *   companyName equality. A client session whose own Firestore record no
 *   longer exists, or whose record has no companyName, resolves to
 *   `isEmpty: true` — the caller must return an empty page directly
 *   rather than fire a query with zero scopes (which fetchShipmentsPage/
 *   fetchShipmentsSince would otherwise read as "no filter at all," i.e.
 *   the admin default of everything — the exact bug this distinction
 *   exists to prevent).
 */
import type { PageFilter } from "./pagination";
import { buildDriverOwnedShipmentQueryScopes } from "./driverVisibility";
import { buildClientOwnedShipmentQueryScopes } from "./clientAccess";

export type ShipmentListSession = {
  role: "admin" | "driver" | "client";
  id: string;
};

export interface ShipmentListScopeResult {
  scopes: PageFilter[][];
  /**
   * True when this session can never legitimately match any shipment
   * (e.g. a client session whose own record is missing/companyName-less)
   * — the caller must short-circuit to an empty page rather than run a
   * query with `scopes`.
   */
  isEmpty: boolean;
}

export function resolveShipmentListQueryScopes(
  session: ShipmentListSession,
  clientCompanyName: string | null | undefined
): ShipmentListScopeResult {
  if (session.role === "driver") {
    return { scopes: buildDriverOwnedShipmentQueryScopes(session.id).map((f) => [f]), isEmpty: false };
  }
  if (session.role === "client") {
    if (!clientCompanyName) return { scopes: [], isEmpty: true };
    const scopes = buildClientOwnedShipmentQueryScopes(clientCompanyName).map((f) => [f]);
    return { scopes, isEmpty: scopes.length === 0 };
  }
  // admin: no filter, sees everything.
  return { scopes: [[]], isEmpty: false };
}
