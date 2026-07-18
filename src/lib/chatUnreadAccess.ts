/**
 * chatUnreadAccess.ts
 *
 * feature/admin-mobile-ui correction pass
 *
 * Pure, testable per-admin chat unread logic — the previous behavior
 * relied on ChatMessage.status ('sent'/'seen'), a single global flag: any
 * admin opening a channel marked it "seen" for every admin, and
 * internal_staff messages (always sender: 'admin') were excluded from
 * "unread" entirely regardless of who sent them, so one admin's message
 * to another never produced a badge at all. This file is the single
 * source of truth for the real behavior — imported by both server.ts
 * (GET /api/chat/unread, POST /api/shipments/:id/chat/seen,
 * POST /api/shipments/:id/chat) and src/components/admin/ChatCenter.tsx
 * (badge caps) — so there is exactly one place deciding "is this unread
 * for this admin," not two that can drift apart.
 *
 * `status` (ChatMessage) is untouched by any of this — it remains the
 * single global driver/client-facing "was my message seen by the admin
 * side" read receipt, a genuinely different concern from an individual
 * admin's own unread badge.
 *
 * Chat-unread scalability follow-up (adminChatUnread): GET /api/chat/unread
 * used to derive an admin's unread set by walking every chatMessages
 * document ever written (paginated, but still O(all messages)) and
 * filtering with isMessageUnreadForAdmin below. It is now backed by a
 * maintained, per-admin Firestore collection — `adminChatUnread`, one
 * document per (adminId, messageId) pair that is currently unread for that
 * admin — so the query is O(this admin's unread set) instead. The
 * ELIGIBILITY rule for who gets a record (isMessageFromOtherAdmin) is
 * unchanged; only where the resulting set is computed/stored changed:
 *  - Write time (POST /api/shipments/:id/chat): planUnreadFanout below
 *    decides, from the full admin roster, which admins get a new
 *    adminChatUnread record for the just-created message.
 *  - Read time (GET /api/chat/unread): server.ts queries
 *    `adminChatUnread` for `adminId == this admin`, no whole-collection
 *    walk of chatMessages required — see selectUnreadMessagesFromRecords.
 *  - Seen time (POST /api/shipments/:id/chat/seen): server.ts deletes
 *    this admin's adminChatUnread records within the exact shipment(+
 *    channel) scope being marked seen — a deleted record IS "read," no
 *    separate flag needed.
 * `readByAdminIds`/`status` on ChatMessage are kept, updated exactly as
 * before (planSeenWrites, chatSeenPlan.ts) for backward compatibility /
 * audit trail, but neither GET /api/chat/unread nor any other endpoint
 * reads them as the source of truth anymore — adminChatUnread's own
 * existence is the sole source of truth for "is this unread," so the two
 * can never drift into disagreement from a live reader's point of view.
 * See scripts/backfill-admin-chat-unread.ts for populating adminChatUnread
 * from chatMessages written before this collection existed.
 */
import type { ChatChannel, ChatMessage } from "../types";
import type { PageFilter } from "./pagination";

export interface UnreadCandidateMessage {
  sender: "admin" | "driver" | "client";
  senderId?: string;
  readByAdminIds?: string[];
}

/**
 * Whether `message` was sent by someone other than the admin
 * `viewerAdminId` — i.e. whether it's even possible for it to be unread
 * for that admin. Driver/client messages always qualify (an admin is
 * never the driver/client). An admin-sent message only qualifies if it
 * carries a senderId that differs from viewerAdminId — a legacy
 * admin-sent message with no senderId at all is treated as NOT from
 * another admin (conservative: never retroactively surfaces old
 * internal_staff messages as unread for everyone once this shipped).
 */
export function isMessageFromOtherAdmin(message: UnreadCandidateMessage, viewerAdminId: string): boolean {
  if (message.sender !== "admin") return true;
  return Boolean(message.senderId) && message.senderId !== viewerAdminId;
}

/**
 * Whether `message` should count toward `viewerAdminId`'s unread badge:
 * from someone else, AND not already in this admin's own read list.
 */
export function isMessageUnreadForAdmin(message: UnreadCandidateMessage, viewerAdminId: string): boolean {
  if (!isMessageFromOtherAdmin(message, viewerAdminId)) return false;
  const readBy = message.readByAdminIds || [];
  return !readBy.includes(viewerAdminId);
}

/**
 * Appends `adminId` to `readByAdminIds` without duplicating it. Pure —
 * returns a new array (or the same reference when already present, so
 * callers can skip a write when nothing changed).
 */
export function appendAdminReader(readByAdminIds: string[] | undefined, adminId: string): string[] {
  const existing = readByAdminIds || [];
  if (existing.includes(adminId)) return existing;
  return [...existing, adminId];
}

/**
 * Badge display rule (WhatsApp/Google-Chat-style): hidden at 0, exact
 * for 1-99, capped at "99+" beyond that. Returns null when nothing
 * should render — callers should render no badge at all in that case,
 * not a "0".
 */
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
}

/**
 * Phase 4 follow-up (chat seen/unread scalability audit) — the exact
 * filter+sort GET /api/chat/unread applies to whatever candidate messages
 * it fetched (server.ts, via fetchAllMatchingDescending — a scoped,
 * paginated walk, never a full-collection scan). Pulled out so this is
 * unit-testable independent of how the candidates were fetched: feeding it
 * the same candidate set regardless of whether it came from one big page
 * or many small chunked pages must always produce the identical result
 * (memory-fallback parity, and parity between a single Firestore read and
 * a chunked one).
 */
export function selectUnreadMessagesForAdmin<T extends UnreadCandidateMessage & { timestamp: string }>(
  messages: T[],
  viewerAdminId: string
): T[] {
  return messages
    .filter((m) => isMessageUnreadForAdmin(m, viewerAdminId))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * One `adminChatUnread` document — see this file's header comment. `id` is
 * deterministic (`${adminId}__${messageId}`, buildAdminChatUnreadRecordId
 * below) so creating it twice for the same admin+message (a retried
 * "send message" request, or re-running the backfill script) is a
 * same-content overwrite, never a duplicate row. `message` is a full,
 * immutable snapshot of the ChatMessage at fan-out time — safe to embed
 * because no endpoint ever edits a chat message's content after creation
 * (only `status`/`readByAdminIds` mutate, neither of which this record or
 * its consumers rely on) — so GET /api/chat/unread can answer entirely
 * from this collection with no secondary chatMessages lookup.
 */
export interface AdminChatUnreadRecord {
  id: string;
  adminId: string;
  messageId: string;
  shipmentId: string;
  channel?: ChatChannel;
  /** Mirrors message.timestamp — the only ordering key GET /api/chat/unread's cursor pagination needs. */
  timestamp: string;
  message: ChatMessage;
  createdAt: string;
}

/** Deterministic adminChatUnread document id for one (admin, message) pair — see AdminChatUnreadRecord's header comment for why determinism matters. */
export function buildAdminChatUnreadRecordId(adminId: string, messageId: string): string {
  return `${adminId}__${messageId}`;
}

/**
 * Write-time recipient resolution (POST /api/shipments/:id/chat): out of
 * every admin the caller knows about, which ones should get a new
 * adminChatUnread record for `message`. Reuses isMessageFromOtherAdmin —
 * the exact same eligibility rule GET /api/chat/unread's old full-scan
 * approach applied per-admin at read time — so a brand-new message (no
 * readers yet) fans out to precisely the admins isMessageUnreadForAdmin
 * would already have called unread for them. Deduplicates `allAdminIds`
 * first so a caller-side duplicate (e.g. a roster listed twice) can never
 * produce two records for the same admin.
 */
export function resolveUnreadFanoutRecipientIds(allAdminIds: string[], message: UnreadCandidateMessage): string[] {
  const uniqueIds = Array.from(new Set(allAdminIds));
  return uniqueIds.filter((adminId) => isMessageFromOtherAdmin(message, adminId));
}

/**
 * Builds the full set of adminChatUnread records a newly-created message
 * should fan out to. `createdAt` is accepted rather than computed here
 * (Date.now() inside a pure function would make this untestable/
 * non-deterministic) — server.ts passes the same timestamp used for the
 * message write itself.
 */
export function planUnreadFanout(allAdminIds: string[], message: ChatMessage, createdAt: string): AdminChatUnreadRecord[] {
  return resolveUnreadFanoutRecipientIds(allAdminIds, message).map((adminId) => ({
    id: buildAdminChatUnreadRecordId(adminId, message.id),
    adminId,
    messageId: message.id,
    shipmentId: message.shipmentId,
    channel: message.channel,
    timestamp: message.timestamp,
    message,
    createdAt,
  }));
}

/**
 * GET /api/chat/unread's response-shaping step once records are already
 * scoped to this admin by the query itself (`adminId == viewerAdminId`).
 * Re-verifies adminId + isMessageFromOtherAdmin per record anyway — the
 * same "never rely on query scoping alone for a permission boundary"
 * convention isMessageInSeenScope (chatSeenPlan.ts) already follows —
 * before unwrapping each record's embedded message snapshot for the
 * response. Order is preserved as given (the caller's query is already
 * timestamp-descending; this never re-sorts).
 */
export function selectUnreadMessagesFromRecords(records: AdminChatUnreadRecord[], viewerAdminId: string): ChatMessage[] {
  return records
    .filter((r) => r.adminId === viewerAdminId && isMessageFromOtherAdmin(r.message, viewerAdminId))
    .map((r) => r.message);
}

/**
 * POST /api/shipments/:id/chat/seen's adminChatUnread query scope — the
 * exact same (shipmentId, channelFilter) boundary buildSeenScopeFilters
 * (chatSeenPlan.ts) already computes for the legacy chatMessages write,
 * plus `adminId` so this admin's "seen" call can never touch another
 * admin's unread records. `channelFilter: null` (admin, no channel
 * specified) matches every channel for this admin+shipment, same
 * "no channel filter = don't restrict" convention buildSeenScopeFilters
 * already uses.
 */
export function buildUnreadClearFilters(adminId: string, shipmentId: string, channelFilter: ChatChannel | null): PageFilter[] {
  const filters: PageFilter[] = [
    { field: "adminId", op: "==", value: adminId },
    { field: "shipmentId", op: "==", value: shipmentId },
  ];
  if (channelFilter) filters.push({ field: "channel", op: "==", value: channelFilter });
  return filters;
}

// ── Legacy channel-less records (fix/admin-mobile-chat-correctness) ──
//
// Every chat message written before the BUG-03 channel partition — and
// every demo seed message — has NO `channel` field, so its adminChatUnread
// record (backfill script / seed fan-out) has none either. A Firestore
// equality filter never matches an absent field, and every admin UI path
// marks seen with an explicit channel, so those records could never be
// cleared: they accumulated forever as stale badge counts (the reported
// 21/37), attached to messages the channel-filtered thread views don't
// even display. The helpers below make them clearable — deterministically
// and narrowly.

/**
 * The audience a legacy channel-less message deterministically belongs
 * to. Safety rules (approved audit correction):
 *  - driver-sent  → driver_admin (a driver can only ever write there)
 *  - client-sent  → client_admin (a client can only ever write there)
 *  - admin-sent   → AMBIGUOUS. internal_staff has required an explicit
 *    channel on every write since it was introduced
 *    (resolveOutgoingChatChannel returns null for an admin without one),
 *    so a channel-less admin message predates the partition and lived in
 *    the old merged driver/client thread — nothing in its metadata proves
 *    which audience it was for, and it must NEVER be silently cleared by
 *    opening Driver, Customer, or Internal.
 */
export type LegacyUnreadAudience = ChatChannel | "ambiguous_legacy_admin_message";

export function resolveLegacyUnreadAudience(message: Pick<ChatMessage, "sender">): LegacyUnreadAudience {
  if (message.sender === "driver") return "driver_admin";
  if (message.sender === "client") return "client_admin";
  return "ambiguous_legacy_admin_message";
}

/**
 * Out of the records already scoped by the query to EXACTLY this
 * adminId + shipmentId, the ids of channel-less records whose message
 * audience deterministically resolves to `requestedChannel`. Records that
 * carry a channel are never touched here (the channel-scoped query
 * already handles them); ambiguous legacy admin messages are never
 * returned. Defense in depth: adminId/shipmentId are re-verified per
 * record even though the caller's query already scoped them — same
 * convention as selectUnreadMessagesFromRecords above.
 */
export function selectChannellessClearableRecordIds(
  records: AdminChatUnreadRecord[],
  adminId: string,
  shipmentId: string,
  requestedChannel: ChatChannel
): string[] {
  return records
    .filter(
      (r) =>
        r.adminId === adminId &&
        r.shipmentId === shipmentId &&
        r.channel === undefined &&
        resolveLegacyUnreadAudience(r.message) === requestedChannel
    )
    .map((r) => r.id);
}

/**
 * Client-side mirror of what a CONFIRMED seen call just deleted
 * server-side: drops this shipment+channel's messages from the local
 * unread array — including channel-less legacy messages whose audience
 * resolves to that channel — so the shipment badge, the channel badge,
 * and the global badge (all derived from this one array) update
 * immediately. Must only ever be applied after the server answered OK
 * (shouldConfirmChannelRead) — a failed seen must leave badges unchanged.
 */
export function dropSeenUnreadMessages(
  messages: ChatMessage[],
  shipmentId: string,
  channel: ChatChannel
): ChatMessage[] {
  return messages.filter((m) => {
    if (m.shipmentId !== shipmentId) return true;
    if (m.channel === channel) return false;
    if (m.channel === undefined && resolveLegacyUnreadAudience(m) === channel) return false;
    return true;
  });
}

/**
 * One shipment+channel scope this admin's seen call confirmed, with the
 * client-clock time the confirmation arrived — see
 * applyUnreadPollResponse below.
 */
export interface ConfirmedSeenScope {
  shipmentId: string;
  channel: ChatChannel;
  confirmedAt: number;
}

/**
 * Anti-resurrection guard for the ~12s unread poll: a response FETCHED
 * BEFORE a seen call succeeded can land AFTER the local optimistic drop
 * and put the cleared badge right back until the next poll. The poll
 * response is re-filtered through every scope confirmed AFTER that
 * request was issued — those records are already deleted server-side, so
 * this converges on server truth rather than diverging from it. Scopes
 * confirmed before the request was issued are NOT re-applied (the server
 * response already reflects them, and a genuinely new message in that
 * scope must be allowed to appear).
 */
export function applyUnreadPollResponse(
  fetched: ChatMessage[],
  confirmedScopes: ConfirmedSeenScope[],
  requestIssuedAt: number
): ChatMessage[] {
  const applicable = confirmedScopes.filter((s) => s.confirmedAt >= requestIssuedAt);
  return applicable.reduce(
    (msgs, scope) => dropSeenUnreadMessages(msgs, scope.shipmentId, scope.channel),
    fetched
  );
}
