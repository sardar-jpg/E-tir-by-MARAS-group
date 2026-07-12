import { describe, it, expect } from "vitest";
import { isNotificationForDriver } from "./notificationAccess";

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
