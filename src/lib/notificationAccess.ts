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
