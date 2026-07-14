/**
 * chatSeenPlan.ts
 *
 * Phase 4 follow-up (Firestore scalability audit) — pure logic extracted
 * from POST /api/shipments/:id/chat/seen (server.ts) so the query-scoping
 * and per-message write decisions are unit-testable without booting the
 * Express server or Firestore. server.ts's route is now a thin
 * orchestrator: build filters with buildSeenScopeFilters, fetch every
 * matching candidate with those filters (via fetchAllMatchingDescending —
 * a scoped, paginated walk, never a full-collection scan), then hand the
 * candidates to planSeenWrites to decide exactly which documents to
 * overwrite and with what data.
 */
import type { ChatChannel, ChatMessage } from "../types";
import type { PageFilter } from "./pagination";
import { isMessageInSeenScope, type ChatRole } from "./chatVisibility";
import { isMessageFromOtherAdmin, appendAdminReader } from "./chatUnreadAccess";

/**
 * The real-Firestore query filters (and, by construction, the exact same
 * filters `applyMemoryFilters` uses in memory-fallback mode) that scope a
 * "mark as seen" call to one shipment and, when the caller's role fixes
 * one, one channel. Shared by both the live query builder and every test
 * below so the query-level scope and isMessageInSeenScope's node-level
 * defense-in-depth check are provably describing the same boundary.
 */
export function buildSeenScopeFilters(shipmentId: string, channelFilter: ChatChannel | null): PageFilter[] {
  const filters: PageFilter[] = [{ field: "shipmentId", op: "==", value: shipmentId }];
  if (channelFilter) filters.push({ field: "channel", op: "==", value: channelFilter });
  return filters;
}

export interface SeenWrite {
  id: string;
  data: ChatMessage;
}

export interface PlanSeenWritesParams {
  viewer: ChatRole;
  channelFilter: ChatChannel | null;
  shipmentId: string;
  /** Session id of the admin viewer, or null for a driver/client viewer (see server.ts's own header comment on this distinction). */
  viewerAdminId: string | null;
}

/**
 * Decides, for each candidate message already fetched via
 * buildSeenScopeFilters, whether it needs a "mark as seen" write and what
 * the resulting document should look like. `candidates` is expected to
 * already be scoped to the right shipment(+channel) by the caller's own
 * query — isMessageInSeenScope is re-checked here anyway as defense in
 * depth (this file's/chatVisibility.ts's existing convention: never rely
 * on query scoping alone for a permission boundary), so passing an
 * out-of-scope candidate is safely a no-op rather than a leak.
 *
 * Every write is a FULL document replacement (server.ts's setDoc wrapper
 * does not merge), so each returned `data` is the complete original
 * message with only `status`/`readByAdminIds` changed — never a partial
 * patch that would silently drop the message's other fields.
 */
export function planSeenWrites(candidates: ChatMessage[], params: PlanSeenWritesParams): SeenWrite[] {
  const { viewer, channelFilter, shipmentId, viewerAdminId } = params;
  const writes: SeenWrite[] = [];

  for (const msg of candidates) {
    if (!isMessageInSeenScope(msg, channelFilter, shipmentId)) continue;

    if (viewerAdminId) {
      // Still also sets status: 'seen' (first-seen-by-any-admin only) for
      // the driver/client-facing read receipt, which stays a single
      // global flag — a genuinely different concern from this admin's own
      // per-admin unread state.
      if (!isMessageFromOtherAdmin(msg, viewerAdminId)) continue;
      const nextReadBy = appendAdminReader(msg.readByAdminIds, viewerAdminId);
      const alreadyGloballySeen = msg.status === "seen";
      if (nextReadBy === msg.readByAdminIds && alreadyGloballySeen) continue;
      writes.push({ id: msg.id, data: { ...msg, status: "seen", readByAdminIds: nextReadBy } });
    } else if (msg.sender !== viewer && msg.status !== "seen") {
      writes.push({ id: msg.id, data: { ...msg, status: "seen" } });
    }
  }

  return writes;
}
