/**
 * shipmentPagination.ts
 *
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * Frontend-side helpers shared by AdminPanel/ClientDashboard/DriverApplication's
 * GET /api/shipments callers.
 *
 * Blocking-issue follow-up: an earlier version of this file also
 * exported `fetchAllShipmentPages`, a page-through-to-exhaustion helper
 * used on every normal load — that meant a user with thousands of
 * shipments still downloaded and held all of them just to open a
 * dashboard. It has been REMOVED, not merely stopped-calling: every
 * caller now fetches a single bounded page (limit 50) on initial load
 * and an explicit "Load Older Shipments" action for more, so a
 * page-through-to-exhaustion helper had no remaining legitimate call
 * site to keep it around for.
 */
import type { Shipment } from "../types";

export interface ShipmentCursorPage {
  items: Shipment[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Merges a `since`-mode delta response (new/changed shipments only) into
 * an already-loaded list — upserts by id (replacing a changed shipment in
 * place, appending a genuinely new one) instead of a full re-fetch, then
 * re-sorts by createdAt descending so display order stays consistent
 * regardless of which ids happened to change. Never drops an
 * already-loaded row (including older ones fetched via "Load Older
 * Shipments") — a delta merge only ever adds/updates entries in the
 * existing map, it never rebuilds it from just `incoming`. See
 * fetchShipmentsSince's own header comment (server.ts) for exactly what
 * this delta does and does not catch (document/share-config-only changes
 * are a documented, out-of-scope-for-this-PR gap — surfaces on the next
 * full load instead).
 */
export function mergeShipmentsSince(existing: Shipment[], incoming: Shipment[]): Shipment[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Blocking-issue fix: whether a shipment list's pagination state
 * (loaded items, cursor, hasMore, delta-poll position) must be reset
 * before the next load — used by AdminPanel (adminEmail/adminType) and
 * DriverApplication (selectedDriverId) to detect an actual account/role
 * change vs. an unrelated re-render. `prevIdentity === null` means "this
 * is the very first check" (nothing to reset — the initial mount's own
 * fresh load already establishes a clean baseline), so it deliberately
 * returns false rather than treating startup as a "change." Only a
 * genuine, non-null-to-different-value transition resets anything —
 * this is what stops a stale cursor/nextCursor from a PREVIOUS account's
 * accessible scope from being reused against a new one (e.g. "Load Older
 * Shipments" resuming from a cursor that belongs to a different scope
 * entirely, or a delta poll silently merging one account's changes into
 * another's list).
 */
export function shouldResetShipmentPagination(prevIdentity: string | null, nextIdentity: string): boolean {
  return prevIdentity !== null && prevIdentity !== nextIdentity;
}
