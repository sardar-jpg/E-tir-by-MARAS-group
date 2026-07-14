/**
 * notificationAccess.ts
 *
 * Notification Phase 1.
 *
 * Pure, testable scoping rule for which notifications belong to a given
 * driver — imported by both server.ts (GET /api/notifications) and
 * DriverApplication.tsx (client-side fetch filtering and the notifications
 * badge/list), so there is exactly one place deciding this instead of two
 * that can silently drift apart.
 *
 * A notification belongs to a driver if either:
 *  - its shipmentId is one of the driver's own shipments (the ordinary
 *    case — assignment/status/chat/etc. notifications), OR
 *  - it is addressed directly to this driver via recipientUserId,
 *    independent of any shipment. Some events have no shipment at all
 *    (e.g. "Driver Approved," sent the moment an admin approves a
 *    self-registered driver, before that driver is necessarily assigned
 *    to anything) — without this second clause, a shipmentId-only scoping
 *    rule silently drops the notification for every driver, no matter who
 *    it was actually for.
 */
import type { ChatChannel } from "../types";
import { isChatNotificationVisibleToRole, type ChatRole } from "./chatVisibility";

export interface DriverScopedNotification {
  shipmentId?: string;
  recipientUserId?: string;
}

export function isNotificationForDriver(
  notification: DriverScopedNotification,
  driverId: string,
  driverShipmentIds: Set<string>
): boolean {
  const belongsToOwnShipment = !!notification.shipmentId && driverShipmentIds.has(notification.shipmentId);
  const addressedDirectly = !!notification.recipientUserId && notification.recipientUserId === driverId;
  return belongsToOwnShipment || addressedDirectly;
}

/**
 * Notification Phase 1 correction.
 *
 * Per-user read state — see AppNotification.readByUserIds in
 * src/types.ts for the full rationale (the legacy `read` boolean is a
 * single flag shared by every user who can see the same notification
 * document; one user's read request flipping it marked the notification
 * read for everyone else too). A notification is read FOR THIS USER only
 * if their own id is present in readByUserIds. Absent/empty
 * readByUserIds — including every notification written before this field
 * existed — means unread for everyone, not "unknown" or "read by
 * default"; there is no fallback to the legacy `read` flag here on
 * purpose, since that flag can no longer be trusted to mean "read by me."
 */
export function isNotificationReadForUser(
  notification: { readByUserIds?: string[] },
  userId: string
): boolean {
  return !!notification.readByUserIds && notification.readByUserIds.includes(userId);
}

/**
 * Notification Phase 1 correction.
 *
 * Computes the next readByUserIds array after this user reads a
 * notification — a pure union: the user's id is added if not already
 * present, and every existing id (any other user who already read it) is
 * preserved untouched. Never returns an array containing only the calling
 * user's id when others were already present — that would silently
 * "unread" the notification for them. Idempotent: reading the same
 * notification twice as the same user produces the same array both
 * times, in the same order (no duplicate entries).
 */
export function addReaderToNotification(
  existingReaderIds: string[] | undefined,
  userId: string
): string[] {
  const merged = new Set(existingReaderIds ?? []);
  merged.add(userId);
  return Array.from(merged);
}

/**
 * Notification Phase 1 correction.
 *
 * Mirrors POST /api/notifications/:id/read's full authorization decision
 * as a pure function, so the exact rule — including the fix below — is
 * unit-testable without booting the Express server. `ownsViaShipment` is
 * computed by the caller (an async Firestore lookup against
 * notif.shipmentId), since that part genuinely can't be pure; everything
 * downstream of it is.
 *
 * Fix: a direct recipient (recipientUserId matching the caller) previously
 * skipped the channel-visibility check entirely in server.ts, because that
 * check lived inside the same `if (!isDirectRecipient)` branch as the
 * shipment-ownership lookup. That meant a direct recipient could, in
 * principle, mark read a client_admin/driver_admin/internal_staff/
 * ai_alert-scoped notification outside their own audience, bypassing the
 * exact rule PR #44 already enforces everywhere else (GET
 * /api/notifications, and shipment-owner-based access on this same
 * route). isChatNotificationVisibleToRole now runs unconditionally for
 * every non-admin caller, regardless of which of the two paths
 * (isDirectRecipient or ownsViaShipment) established their access.
 */
export function canMarkNotificationRead(
  notification: { type: string; channel?: ChatChannel; recipientUserId?: string },
  role: ChatRole,
  callerId: string,
  ownsViaShipment: boolean
): boolean {
  if (role === "admin") return true;
  const isDirectRecipient = !!notification.recipientUserId && notification.recipientUserId === callerId;
  if (!isDirectRecipient && !ownsViaShipment) return false;
  return isChatNotificationVisibleToRole(notification.type, role, notification.channel);
}

/**
 * Phase 4 (Firestore scalability audit).
 *
 * GET /api/notifications previously read the *entire* notifications
 * collection on every call and threw most of it away in Node (filtering
 * by shipment membership / recipientUserId only after the fact). This
 * function is the query-level equivalent of `isNotificationForDriver`'s
 * OR (own-shipment OR direct-recipient) rule, expressed as which real
 * Firestore queries to run instead of which predicate to filter with —
 * used identically by the real-Firestore path and the memory-fallback
 * path in server.ts, so both are guaranteed to scope notifications the
 * same way by construction.
 *
 * Firestore's `in` operator caps at 30 values, so `shipmentIds` is
 * truncated to the first 30 here. This can only ever *narrow* — never
 * broaden — what a driver/client sees: a driver/client with more than 30
 * shipments simply won't see notifications for shipments past the first
 * 30 in this list, the same fail-safe direction as every other access
 * check in this file. Fixing that fully requires paginating the
 * shipment-ownership lookup itself (Orders/Shipments, deferred — see
 * docs/FOLLOW_UP_ROADMAP.md).
 *
 * Returns one or two independent query scopes rather than one combined
 * query: Firestore has no native way to OR an `in` filter on one field
 * with an `==` filter on a different field while also ordering/paginating
 * the result, short of a composite `Filter.or(...)` whose required index
 * shape can't be verified without deploying against a live project (out
 * of scope for this task — indexes are committed, not deployed). Two
 * plain, independently-indexed queries merged in server.ts is the
 * conservative, verifiable choice; `recipientUserId`-only notifications
 * are a rare, one-time-per-lifecycle-event case (e.g. "Driver Approved"),
 * so the extra query is cheap, not a second full scan.
 */
export interface NotificationQueryScope {
  field: "shipmentId" | "recipientUserId";
  op: "in" | "==";
  value: string[] | string;
}

export function buildDriverClientNotificationQueryScopes(
  sessionId: string,
  ownedShipmentIds: string[]
): NotificationQueryScope[] {
  const scopes: NotificationQueryScope[] = [];
  const cappedShipmentIds = ownedShipmentIds.slice(0, 30);
  if (cappedShipmentIds.length > 0) {
    scopes.push({ field: "shipmentId", op: "in", value: cappedShipmentIds });
  }
  scopes.push({ field: "recipientUserId", op: "==", value: sessionId });
  return scopes;
}
