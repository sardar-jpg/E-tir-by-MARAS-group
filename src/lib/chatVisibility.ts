/**
 * chatVisibility.ts
 *
 * BUG-03: shipment chat is partitioned into audiences —
 * 'driver_admin' (dispatch/operational chat) and 'client_admin'
 * (customer-service chat) — so a driver never sees a client's identity or
 * messages, and a client never sees internal driver/admin operational
 * chat. Previously every role read/wrote the same unfiltered
 * `chatMessages` collection for a shipment.
 *
 * PR #34 adds a third audience, 'internal_staff' — MARAS staff discussing
 * a shipment among themselves. It is admin-only: driver and client
 * sessions must never read or write it, and it must never reach the
 * public share proxy. Concretely this means driver/client are never
 * allowed to resolve or request that channel (see
 * canAccessInternalStaffChannel below), on top of the existing
 * own-channel-only filtering they already get.
 *
 * Extracted from server.ts (same rationale as shipmentView.ts / auth.ts)
 * so the filtering/classification rules can be unit tested without
 * booting the full Express server.
 *
 * Messages written before the `channel` field existed have no channel at
 * all. Those are only ever shown to admins — an untagged message could
 * belong to any audience and might contain another party's identity, so
 * it's withheld from driver/client rather than guessed at.
 */
import type { ChatChannel } from "../types";

export type ChatRole = "admin" | "driver" | "client";

/**
 * Server-side GET filter for /api/shipments/:id/chat. `requestedChannel`
 * is only honored for admins (query param), never for driver/client —
 * their channel is fixed by their verified role, not client input.
 */
export function filterChatMessagesByRole<T extends { channel?: ChatChannel }>(
  messages: T[],
  role: ChatRole,
  requestedChannel?: string
): T[] {
  if (role === "driver") {
    return messages.filter((m) => m.channel === "driver_admin");
  }
  if (role === "client") {
    return messages.filter((m) => m.channel === "client_admin");
  }
  // admin
  if (requestedChannel === "driver_admin" || requestedChannel === "client_admin" || requestedChannel === "internal_staff") {
    return messages.filter((m) => m.channel === requestedChannel);
  }
  return messages;
}

/**
 * Resolves which channel an outgoing chat message should be stored/sent
 * under. Driver and client are forced to their own channel regardless of
 * any client-supplied value (never trust that input). Admin must specify
 * a valid channel explicitly — returns null if they didn't, so the caller
 * can reject the request rather than silently broadcasting to the wrong
 * (or both) audience(s).
 */
export function resolveOutgoingChatChannel(
  sender: ChatRole,
  requestedChannel?: string
): ChatChannel | null {
  if (sender === "driver") return "driver_admin";
  if (sender === "client") return "client_admin";
  if (requestedChannel === "driver_admin" || requestedChannel === "client_admin" || requestedChannel === "internal_staff") {
    return requestedChannel;
  }
  return null;
}

/**
 * Which channel a "mark as seen" call is allowed to touch. Driven by the
 * verified session role (not the client-supplied `viewer`), so viewing
 * one audience's thread can't silently flip read-receipts on the other
 * audience's messages. Returns null for an admin who didn't specify a
 * channel, meaning "no restriction" (matches the merged admin GET default).
 */
export function resolveSeenChannelFilter(
  role: ChatRole,
  requestedChannel?: string
): ChatChannel | null {
  if (role === "driver") return "driver_admin";
  if (role === "client") return "client_admin";
  if (requestedChannel === "driver_admin" || requestedChannel === "client_admin" || requestedChannel === "internal_staff") {
    return requestedChannel;
  }
  return null;
}

/**
 * Whether a chat push notification should reach a given party (driver or
 * client) for this shipment. Non-chat notification types are unaffected
 * (always true) — only 'chat' notifications carry the sender's identity
 * and message text that must stay within its own audience.
 */
export function shouldNotifyChatParty(
  notificationType: string,
  party: "driver" | "client",
  chatChannel?: ChatChannel
): boolean {
  if (notificationType !== "chat") return true;
  return party === "driver" ? chatChannel === "driver_admin" : chatChannel === "client_admin";
}

/**
 * Whether a stored notification (from GET /api/notifications) may be
 * shown to this role. Only 'chat' notifications are restricted; a
 * legacy/untagged chat notification has no reliable audience and is
 * withheld from driver/client rather than risk leaking it.
 */
export function isChatNotificationVisibleToRole(
  notificationType: string,
  role: ChatRole,
  notificationChannel?: ChatChannel
): boolean {
  if (notificationType !== "chat") return true;
  if (role === "driver") return notificationChannel === "driver_admin";
  if (role === "client") return notificationChannel === "client_admin";
  return true;
}

/**
 * PR #34: explicit gate for the 'internal_staff' channel, on top of the
 * own-channel-only filtering every other helper in this file already does.
 * Called directly by the chat routes in server.ts so a driver/client
 * request for `?channel=internal_staff` (or POST body `channel:
 * "internal_staff"`) gets a hard 403 instead of silently falling through
 * to the (also-safe, but less explicit) per-role filtering elsewhere.
 */
export function canAccessInternalStaffChannel(role: ChatRole): boolean {
  return role === "admin";
}
