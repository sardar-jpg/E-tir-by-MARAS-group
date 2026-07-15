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

const CHAT_ROLES: readonly ChatRole[] = ["admin", "driver", "client"];

/**
 * Server-side guard for any endpoint that accepts a client-supplied
 * `viewer`/role value (currently POST /api/shipments/:id/chat/seen). An
 * unrecognized value must never reach planSeenWrites: its `sender !==
 * viewer` write rule would then treat *every* message as unseen by that
 * bogus viewer and mark them all seen, so this has to reject before any
 * Firestore read/write — not just coerce or default the value.
 */
export function isValidChatRole(value: unknown): value is ChatRole {
  return typeof value === "string" && (CHAT_ROLES as readonly string[]).includes(value);
}

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
 * fix/chat-safety-reliability-phase1 (follow-up): the exact per-message
 * scope check POST /api/shipments/:id/chat/seen (server.ts) applies to
 * every candidate message before touching readByAdminIds/status — pulled
 * out here (and used directly by that route, not reimplemented) so it's
 * unit-testable on its own. `channelFilter` is `resolveSeenChannelFilter`'s
 * output: a null filter means "no channel restriction" (the merged admin
 * GET default); otherwise a message must match both the given channel AND
 * shipment to be in scope. This is what guarantees, e.g., marking
 * driver_admin as read for one shipment can never touch an internal_staff
 * message, or the same channel's messages on a different shipment.
 */
export function isMessageInSeenScope(
  message: { channel?: ChatChannel; shipmentId?: string },
  channelFilter: ChatChannel | null,
  shipmentId: string
): boolean {
  if (channelFilter && message.channel !== channelFilter) return false;
  if (message.shipmentId !== shipmentId) return false;
  return true;
}

/**
 * Whether a chat push notification should reach a given party (driver or
 * client) for this shipment. Non-channel-tagged notification types are
 * unaffected (always true) — 'chat' and 'doc_upload' are the two types
 * that can carry a chatChannel (see AppNotification.channel), and both
 * must stay within their own audience: 'chat' because its title/body
 * carries the sender's identity and message text, 'doc_upload' because
 * the only call site that fires it (a client_admin chat file attachment,
 * server.ts) must not also page the driver just because doc_upload
 * itself isn't channel-partitioned by default (PR #44).
 */
export function shouldNotifyChatParty(
  notificationType: string,
  party: "driver" | "client",
  chatChannel?: ChatChannel
): boolean {
  // PR #44 — MARAS AI notification readiness: 'ai_alert' is reserved for a
  // future admin-only alert type (see AppNotification.type / AI_ALERT_
  // NOTIFICATION_TYPE in types.ts). No call site creates it yet — this
  // branch exists so that whenever one does, it is admin-only by
  // construction rather than depending on that future call site
  // remembering to exclude driver/client itself.
  if (notificationType === "ai_alert") return false;
  if (notificationType !== "chat" && notificationType !== "doc_upload") return true;
  return party === "driver" ? chatChannel === "driver_admin" : chatChannel === "client_admin";
}

/**
 * Whether a stored notification (from GET /api/notifications) may be
 * shown to this role. Only channel-taggable types ('chat', 'doc_upload')
 * are restricted; a legacy/untagged chat notification has no reliable
 * audience and is withheld from driver/client rather than risk leaking it.
 */
export function isChatNotificationVisibleToRole(
  notificationType: string,
  role: ChatRole,
  notificationChannel?: ChatChannel
): boolean {
  // PR #44: same reservation as shouldNotifyChatParty above — 'ai_alert'
  // is admin-only regardless of channel, by construction, ahead of any
  // real AI provider integration.
  if (notificationType === "ai_alert") return role === "admin";
  if (notificationType !== "chat" && notificationType !== "doc_upload") return true;
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

/**
 * PR #35 / PR #39: whether posting a chat file attachment on this channel
 * should also create a shipment.documents entry (+ its "doc_upload"
 * notification). shipment.documents is returned unfiltered to driver/client
 * (buildShipmentViewForRole, src/lib/shipmentView.ts) and, once
 * isSharedExternally/shareIncludeDocuments allow it, to the public share
 * view (publicShareView.ts) — neither of those checks the chat channel a
 * document came from. So anything saved here reaches the customer's
 * dashboard and, if link sharing is on, the public tracking page, with no
 * further admin review.
 *
 * Only an *admin-sent* client_admin attachment qualifies — that's an admin
 * deliberately publishing an official document (invoice, CMR, POD, etc.) to
 * the customer via chat, same as the Document Center. driver_admin and
 * internal_staff stay excluded for the reasons above (PR #39: mirroring a
 * driver_admin attachment let it reach the customer dashboard and public
 * share link with zero admin approval).
 *
 * PR #62 (Customer Chat File Upload UI) added client-side uploads to this
 * same client_admin channel and narrowed this further to admin-sent only:
 * a customer/client-staff upload is chat-only and must NOT auto-promote
 * into shipment.documents (so it never reaches the public share link
 * without review) — a customer already sent/has the file, so nothing is
 * hidden from them by not mirroring it. An admin can separately choose to
 * re-upload/approve a customer's chat file as an official document through
 * the document center later; no such conversion flow exists yet, and this
 * PR does not add one.
 */
export function shouldSaveChatFileAsShipmentDocument(
  channel?: ChatChannel,
  sender?: ChatRole
): boolean {
  return channel === "client_admin" && sender === "admin";
}
