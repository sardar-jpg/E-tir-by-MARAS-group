import { describe, it, expect } from "vitest";
import {
  isNotificationForDriver,
  isNotificationReadForUser,
  addReaderToNotification,
  canMarkNotificationRead,
} from "./notificationAccess";

describe("isNotificationForDriver — Notification Phase 1", () => {
  it("is true when the notification's shipmentId is one of the driver's own shipments", () => {
    const notif = { shipmentId: "ship-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1", "ship-2"]))).toBe(true);
  });

  it("is false when the shipmentId does not belong to the driver and there is no recipientUserId", () => {
    const notif = { shipmentId: "ship-99" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1", "ship-2"]))).toBe(false);
  });

  it("is true when recipientUserId matches the driver, even with no shipment at all — the 'Driver Approved' case", () => {
    const notif = { shipmentId: "", recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set())).toBe(true);
  });

  it("is false when recipientUserId is set but belongs to a different driver", () => {
    const notif = { shipmentId: "", recipientUserId: "driver-2" };
    expect(isNotificationForDriver(notif, "driver-1", new Set())).toBe(false);
  });

  it("is false for a notification with neither a matching shipment nor a matching recipientUserId", () => {
    const notif = { shipmentId: "ship-99", recipientUserId: "driver-2" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1"]))).toBe(false);
  });

  it("is true when both conditions independently match (own shipment AND directly addressed)", () => {
    const notif = { shipmentId: "ship-1", recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1"]))).toBe(true);
  });

  it("treats a missing shipmentId the same as an empty one — never a false match against an empty-string shipment id", () => {
    const notif = { recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set([""]))).toBe(true);
    expect(isNotificationForDriver({ shipmentId: "" }, "driver-1", new Set([""]))).toBe(false);
  });
});

describe("Per-user read state — Notification Phase 1 correction", () => {
  describe("isNotificationReadForUser / addReaderToNotification", () => {
    it("Driver A reading a notification does not mark it read for Driver B", () => {
      const notif = { readByUserIds: undefined as string[] | undefined };
      notif.readByUserIds = addReaderToNotification(notif.readByUserIds, "driver-A");
      expect(isNotificationReadForUser(notif, "driver-A")).toBe(true);
      expect(isNotificationReadForUser(notif, "driver-B")).toBe(false);
    });

    it("a Driver reading a notification does not mark it read for Admin or Client", () => {
      const notif = { readByUserIds: addReaderToNotification(undefined, "driver-1") };
      expect(isNotificationReadForUser(notif, "driver-1")).toBe(true);
      expect(isNotificationReadForUser(notif, "admin@maras.iq")).toBe(false);
      expect(isNotificationReadForUser(notif, "client-1")).toBe(false);
    });

    it("repeated reads by the same user are idempotent — no duplicate entries, same result every time", () => {
      let readByUserIds: string[] | undefined = undefined;
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      expect(readByUserIds).toEqual(["driver-1"]);
      expect(isNotificationReadForUser({ readByUserIds }, "driver-1")).toBe(true);
    });

    it("existing readByUserIds entries are preserved when a new user reads it", () => {
      const existing = ["admin@maras.iq", "driver-1"];
      const updated = addReaderToNotification(existing, "driver-2");
      expect(updated).toContain("admin@maras.iq");
      expect(updated).toContain("driver-1");
      expect(updated).toContain("driver-2");
      expect(updated).toHaveLength(3);
      // the original array passed in is untouched (pure function)
      expect(existing).toEqual(["admin@maras.iq", "driver-1"]);
    });

    it("a legacy notification with no readByUserIds field at all remains safely readable", () => {
      const legacyNotif: { read: boolean; readByUserIds?: string[] } = { read: true }; // pre-existing shape, no readByUserIds
      expect(isNotificationReadForUser(legacyNotif, "driver-1")).toBe(false);
      const afterRead = addReaderToNotification(legacyNotif.readByUserIds, "driver-1");
      expect(afterRead).toEqual(["driver-1"]);
      expect(isNotificationReadForUser({ readByUserIds: afterRead }, "driver-1")).toBe(true);
    });

    it("an empty readByUserIds array means unread for everyone, not read-by-default", () => {
      expect(isNotificationReadForUser({ readByUserIds: [] }, "driver-1")).toBe(false);
    });
  });

  describe("canMarkNotificationRead — direct-recipient channel enforcement", () => {
    it("admin can always mark any notification read, regardless of type/channel", () => {
      expect(canMarkNotificationRead({ type: "chat", channel: "internal_staff" }, "admin", "admin-1", false)).toBe(true);
      expect(canMarkNotificationRead({ type: "ai_alert" }, "admin", "admin-1", false)).toBe(true);
    });

    it("a direct recipient is REJECTED for a chat notification outside their own channel — the core fix", () => {
      // recipientUserId matches the caller (driver-1), but the notification
      // is client_admin-scoped chat — a driver must never read this, direct
      // recipient or not.
      const notif = { type: "chat", channel: "client_admin" as const, recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });

    it("a direct recipient is REJECTED for an internal_staff notification", () => {
      const notif = { type: "doc_upload", channel: "internal_staff" as const, recipientUserId: "client-1" };
      expect(canMarkNotificationRead(notif, "client", "client-1", false)).toBe(false);
    });

    it("a direct recipient is REJECTED for ai_alert regardless of channel", () => {
      const notif = { type: "ai_alert", recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });

    it("a direct recipient IS allowed for a non-channel-gated type (e.g. driver_registration, the real 'Driver Approved' case)", () => {
      const notif = { type: "driver_registration", recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(true);
    });

    it("a direct recipient IS allowed for their own correctly-scoped chat channel", () => {
      const notif = { type: "chat", channel: "driver_admin" as const, recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(true);
    });

    it("shipment ownership still requires the correct channel too (pre-existing PR #44 rule, unchanged)", () => {
      const notif = { type: "chat", channel: "client_admin" as const };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", true)).toBe(false);
      const ownChannel = { type: "chat", channel: "driver_admin" as const };
      expect(canMarkNotificationRead(ownChannel, "driver", "driver-1", true)).toBe(true);
    });

    it("neither a direct recipient nor a shipment owner is rejected outright, before the channel check even matters", () => {
      const notif = { type: "status_update" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });
  });
});
