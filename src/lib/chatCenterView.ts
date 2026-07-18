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
