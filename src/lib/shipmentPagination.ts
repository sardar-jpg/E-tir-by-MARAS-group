/**
 * shipmentPagination.ts
 *
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * Frontend-side helpers shared by AdminPanel/ClientDashboard/DriverApplication's
 * GET /api/shipments callers. The backend now returns bounded,
 * cursor-paginated pages (`{ items, nextCursor, hasMore }` /
 * `{ items, hasMore }`) instead of the caller's whole accessible-scope
 * shipment list in one response — these two pure functions are the
 * "reassemble what callers already expect from those pages" logic,
 * factored out once instead of copy-pasted across all three callers.
 */
import type { Shipment } from "../types";

export interface ShipmentCursorPage {
  items: Shipment[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Fetches every page of a cursor-paginated /api/shipments response and
 * concatenates them in the order returned (newest first) — reconstructs
 * the same "whole accessible scope, newest first" list a single unbounded
 * request used to return in one shot, via N bounded (limit ≤ 200)
 * requests instead of one unbounded one. AdminPanel's dashboard
 * aggregates (status counts, currency sums, route breakdown,
 * document-completion stats) and the client/driver dashboards' own
 * filtering all depend on seeing the complete accessible scope, not just
 * the newest page — this is how this PR preserves that without
 * reintroducing a single unbounded Firestore read.
 */
export async function fetchAllShipmentPages(
  fetchPage: (cursor: string | null) => Promise<ShipmentCursorPage>
): Promise<Shipment[]> {
  const all: Shipment[] = [];
  let cursor: string | null = null;
  // Hard safety cap against ever looping unboundedly if hasMore/nextCursor
  // somehow never converged — not expected to be hit in practice (200
  // shipments/page x 50 pages = 10,000 shipments before this triggers).
  const MAX_PAGES = 50;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

/**
 * Merges a `since`-mode delta response (new/changed shipments only) into
 * an already-loaded list — upserts by id (replacing a changed shipment in
 * place, appending a genuinely new one) instead of a full re-fetch, then
 * re-sorts by createdAt descending so display order stays consistent
 * regardless of which ids happened to change. See fetchShipmentsSince's
 * own header comment (server.ts) for exactly what this delta does and
 * does not catch (document/share-config-only changes are a documented,
 * out-of-scope-for-this-PR gap — surfaces on the next full load instead).
 */
export function mergeShipmentsSince(existing: Shipment[], incoming: Shipment[]): Shipment[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
