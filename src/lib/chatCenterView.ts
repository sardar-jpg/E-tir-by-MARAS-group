/**
 * chatCenterView.ts
 *
 * Pure helpers for the Admin Chat Center's shipment conversation list
 * (src/components/admin/ChatCenter.tsx). Extracted so the search/unread
 * summary logic is unit-testable without a DOM testing library — this repo
 * only runs plain Vitest node tests (see chatVisibility.ts for the same
 * pattern).
 *
 * No new privacy surface here: `summarizeUnreadForShipment` only reads from
 * `unreadChatMessages`, which the caller already fetched from the
 * admin-only GET /api/chat/unread endpoint (same data already shown in the
 * existing unread chat dropdown).
 */
import type { ChatChannel, ChatMessage, Shipment } from "../types";
import { resolveLegacyUnreadAudience } from "./chatUnreadAccess";

export function filterShipmentsBySearch<T extends { shipmentNumber: string }>(
  shipments: T[],
  query: string
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return shipments;
  return shipments.filter((s) => s.shipmentNumber.toLowerCase().includes(trimmed));
}

export interface UnreadSummary {
  count: number;
  lastMessage: ChatMessage | null;
}

/**
 * Aggregates unread messages for one shipment across both channels, most
 * recent first, for the Chat Center list's badge + preview. Returns
 * count: 0 / lastMessage: null when there's nothing unread for this
 * shipment — the caller renders no badge/preview in that case ("if
 * available", per the UX brief).
 */
export function summarizeUnreadForShipment(
  unreadMessages: ChatMessage[],
  shipmentId: string
): UnreadSummary {
  const forShipment = unreadMessages.filter((m) => m.shipmentId === shipmentId);
  if (forShipment.length === 0) {
    return { count: 0, lastMessage: null };
  }
  const sorted = [...forShipment].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return { count: forShipment.length, lastMessage: sorted[0] };
}

export function shipmentRouteLabel(shipment: Pick<Shipment, "loadingCity" | "deliveryCity">): string {
  return `${shipment.loadingCity} → ${shipment.deliveryCity}`;
}

// ── Recent-activity ordering (feature/admin-chat-recent-activity-order) ──

/**
 * The newest KNOWN chat activity for one Order's room, as the maximum of
 * three sources (all ISO-8601 strings, so plain lexicographic comparison
 * is chronological — no Date parsing in the sort hot path):
 *  1. shipment.lastChatActivityAt — the durable, server-maintained
 *     summary written atomically with every message create
 *     (commitChatMessageWithUnreadFanout, server.ts);
 *  2. the newest unreadChatMessages timestamp for this shipment — moves
 *     an Order up within one ≤12s badge poll when SOMEONE ELSE sends,
 *     even before this client refetches the shipment record;
 *  3. localActivity[shipmentId] — the Chat Center's own session memory
 *     (set the moment the current admin sends, and when an opened
 *     thread loads its newest page), which is also what keeps a LEGACY
 *     Order (no lastChatActivityAt yet) from sliding back down when
 *     reading clears its unread entries: activity happened; reading
 *     doesn't un-happen it.
 * Returns null when no activity is known from any source.
 */
export function resolveShipmentChatActivityAt(
  shipment: Pick<Shipment, "id" | "lastChatActivityAt">,
  newestUnreadByShipment: Map<string, string>,
  localActivity: Record<string, string>
): string | null {
  let latest = shipment.lastChatActivityAt || "";
  const unreadTs = newestUnreadByShipment.get(shipment.id);
  if (unreadTs && unreadTs > latest) latest = unreadTs;
  const localTs = localActivity[shipment.id];
  if (localTs && localTs > latest) latest = localTs;
  return latest || null;
}

/** Newest unread-message timestamp per shipment, indexed once per sort (O(unread)). */
export function indexNewestUnreadByShipment(unreadMessages: ChatMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of unreadMessages) {
    const prev = map.get(m.shipmentId);
    if (!prev || m.timestamp > prev) map.set(m.shipmentId, m.timestamp);
  }
  return map;
}

/**
 * WhatsApp/Telegram-style Chat Center ordering: the Order with the most
 * recent chat activity (any of its three channels, any sender role)
 * first. Orders with NO known activity sort below every Order that has
 * some, falling back to shipment creation time. Fully deterministic
 * tie-break: activity timestamp desc → createdAt desc → shipmentId
 * ascending. Pure and non-mutating — returns a new array with exactly
 * the same rows (nothing duplicated, nothing dropped), so callers can
 * filter first (search) and the surviving rows keep this same order.
 * NOT derived from unread state alone: clearing unread never demotes an
 * Order (sources 1 and 3 above persist through a read).
 */
export function sortShipmentsByChatActivity<
  T extends Pick<Shipment, "id" | "createdAt" | "lastChatActivityAt">
>(shipments: T[], unreadMessages: ChatMessage[], localActivity: Record<string, string>): T[] {
  const newestUnread = indexNewestUnreadByShipment(unreadMessages);
  return [...shipments].sort((a, b) => {
    const aActivity = resolveShipmentChatActivityAt(a, newestUnread, localActivity);
    const bActivity = resolveShipmentChatActivityAt(b, newestUnread, localActivity);
    if (aActivity && bActivity && aActivity !== bActivity) return aActivity < bActivity ? 1 : -1;
    if (aActivity && !bActivity) return -1;
    if (!aActivity && bActivity) return 1;
    const aCreated = a.createdAt || "";
    const bCreated = b.createdAt || "";
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * fix/admin-mobile-chat-correctness: per-channel unread count for one
 * shipment's channel tabs, derived from the SAME authoritative
 * unreadMessages array as the shipment badge and the global badge.
 * Channel-less legacy messages count toward the channel their audience
 * deterministically resolves to (driver → driver_admin, client →
 * client_admin) — the same rule the server's seen-clear now applies — so
 * the number shown on a tab always equals what opening that tab will
 * clear. An ambiguous legacy admin message (resolveLegacyUnreadAudience)
 * counts toward NO channel tab: opening a channel never clears it, so
 * showing it on a tab would create an unclearable tab badge; it still
 * counts in the per-shipment total (summarizeUnreadForShipment), where
 * the reconciliation script is the documented resolution path.
 */
export function countUnreadForChannel(
  unreadMessages: ChatMessage[],
  shipmentId: string,
  channel: ChatChannel
): number {
  return unreadMessages.filter((m) => {
    if (m.shipmentId !== shipmentId) return false;
    if (m.channel) return m.channel === channel;
    return resolveLegacyUnreadAudience(m) === channel;
  }).length;
}
