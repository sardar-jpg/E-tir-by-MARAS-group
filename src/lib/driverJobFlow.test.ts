import { describe, it, expect } from "vitest";
import type { AppNotification, Shipment, ShipmentStatus } from "../types";
import {
  hasRemainingDriverAction,
  getDriverJobGroup,
  selectDriverActiveJob,
  shouldReportDriverLocation,
  buildDriverLocationUpdatePayload,
  getDriverNextAction,
  localizeNextActionLabel,
  countUnreadChatForShipment,
  isDriverChatAvailable,
} from "./driverJobFlow";
import { LAND_STATUS_SEQUENCE } from "./shipmentStatusTransitions";

function job(id: string, status: ShipmentStatus, updatedAt = "2026-01-01T00:00:00.000Z", freightType?: "land" | "sea" | "air") {
  return { id, status, updatedAt, freightType } as Pick<Shipment, "id" | "status" | "freightType" | "updatedAt">;
}

describe("getDriverJobGroup", () => {
  it("groups Assigned and New as upcoming — awaiting acceptance / back with dispatch", () => {
    expect(getDriverJobGroup("Assigned")).toBe("upcoming");
    expect(getDriverJobGroup("New")).toBe("upcoming");
  });

  it("groups every in-progress Land status as active — including Arrived", () => {
    for (const status of ["Accepted", "Loading", "Loaded", "In Transit", "Border Crossing", "Customs Clearance", "Arrived"] as ShipmentStatus[]) {
      expect(getDriverJobGroup(status)).toBe("active");
    }
  });

  it("Arrived is NEVER completed for the driver — Delivered is still theirs to submit", () => {
    expect(getDriverJobGroup("Arrived")).toBe("active");
    expect(hasRemainingDriverAction("Arrived")).toBe(true);
    expect(getDriverNextAction("Arrived")?.nextStatus).toBe("Delivered");
  });

  it("Delivered and Closed are completed for the driver (no driver-submittable status remains)", () => {
    expect(getDriverJobGroup("Delivered")).toBe("completed");
    expect(getDriverJobGroup("Closed")).toBe("completed");
    expect(hasRemainingDriverAction("Delivered")).toBe(false);
  });

  it("Sea/Air terminal grouping uses Completed, and Delivered is completed there too", () => {
    expect(getDriverJobGroup("Delivered", "sea")).toBe("completed");
    expect(getDriverJobGroup("Completed", "sea")).toBe("completed");
    expect(getDriverJobGroup("Out for Delivery", "air")).toBe("active");
  });
});

describe("selectDriverActiveJob — the one shared active-job rule", () => {
  it("prefers a job already underway over one merely assigned", () => {
    const assigned = job("a", "Assigned", "2026-01-05T00:00:00.000Z");
    const transit = job("b", "In Transit", "2026-01-01T00:00:00.000Z");
    expect(selectDriverActiveJob([assigned, transit])?.id).toBe("b");
  });

  it("falls back to the Assigned job when nothing is underway", () => {
    const assigned = job("a", "Assigned");
    const delivered = job("b", "Delivered", "2026-02-01T00:00:00.000Z");
    expect(selectDriverActiveJob([delivered, assigned])?.id).toBe("a");
  });

  it("an Arrived job still counts as the active job", () => {
    const arrived = job("a", "Arrived");
    const closed = job("b", "Closed");
    expect(selectDriverActiveJob([closed, arrived])?.id).toBe("a");
  });

  it("returns null when every job is completed for the driver", () => {
    expect(selectDriverActiveJob([job("a", "Delivered"), job("b", "Closed")])).toBeNull();
    expect(selectDriverActiveJob([])).toBeNull();
  });

  it("breaks ties by most recently updated", () => {
    const older = job("a", "In Transit", "2026-01-01T00:00:00.000Z");
    const newer = job("b", "Loading", "2026-03-01T00:00:00.000Z");
    expect(selectDriverActiveJob([older, newer])?.id).toBe("b");
  });
});

describe("shouldReportDriverLocation — GPS lifecycle", () => {
  it("does NOT stop reporting merely because the status is Arrived", () => {
    expect(shouldReportDriverLocation("Arrived")).toBe(true);
  });

  it("reports from Accepted through Arrived, never before acceptance", () => {
    expect(shouldReportDriverLocation("Assigned")).toBe(false);
    expect(shouldReportDriverLocation("New")).toBe(false);
    expect(shouldReportDriverLocation("Accepted")).toBe(true);
    expect(shouldReportDriverLocation("In Transit")).toBe(true);
  });

  it("stops at the driver's true terminal point — Delivered onward", () => {
    expect(shouldReportDriverLocation("Delivered")).toBe(false);
    expect(shouldReportDriverLocation("Closed")).toBe(false);
    expect(shouldReportDriverLocation("Completed", "sea")).toBe(false);
  });
});

describe("buildDriverLocationUpdatePayload — location-only, never a profile spread", () => {
  it("contains exactly latitude, longitude, lastUpdated and nothing else", () => {
    const payload = buildDriverLocationUpdatePayload(36.19, 44.01, "2026-07-16T10:00:00.000Z");
    expect(payload).toEqual({ latitude: 36.19, longitude: 44.01, lastUpdated: "2026-07-16T10:00:00.000Z" });
    expect(Object.keys(payload).sort()).toEqual(["lastUpdated", "latitude", "longitude"]);
  });
});

describe("getDriverNextAction — one legal forward action, no free-form list", () => {
  it("never offers an action at New or Assigned (accept/decline is a dedicated workflow)", () => {
    expect(getDriverNextAction("New")).toBeNull();
    expect(getDriverNextAction("Assigned")).toBeNull();
  });

  it("walks the Land sequence one step at a time with driver-friendly labels in all three languages", () => {
    const expectations: Array<[ShipmentStatus, ShipmentStatus, string]> = [
      ["Accepted", "Loading", "Start Loading"],
      ["Loading", "Loaded", "Cargo Loaded"],
      ["Loaded", "In Transit", "Start Journey"],
      ["In Transit", "Border Crossing", "Reached Border"],
      ["Border Crossing", "Customs Clearance", "Start Customs Clearance"],
      ["Customs Clearance", "Arrived", "Arrived at Destination"],
      ["Arrived", "Delivered", "Confirm Delivery"],
    ];
    for (const [current, next, en] of expectations) {
      const action = getDriverNextAction(current);
      expect(action?.nextStatus).toBe(next);
      expect(action?.label.en).toBe(en);
      expect(action?.label.tr).toBeTruthy();
      expect(action?.label.ar).toBeTruthy();
      expect(localizeNextActionLabel(action!, "en")).toBe(en);
    }
  });

  it("never offers backward, skipped, or closing statuses anywhere in the Land sequence", () => {
    for (let i = 0; i < LAND_STATUS_SEQUENCE.length; i++) {
      const current = LAND_STATUS_SEQUENCE[i];
      const action = getDriverNextAction(current);
      if (action) {
        // Exactly one step forward…
        expect(LAND_STATUS_SEQUENCE.indexOf(action.nextStatus)).toBe(i + 1);
        // …and never the closing status.
        expect(action.nextStatus).not.toBe("Closed");
      }
    }
  });

  it("offers no action at Delivered — but that is a chat-lock question, not answered here", () => {
    expect(getDriverNextAction("Delivered")).toBeNull();
    expect(getDriverNextAction("Delivered", "sea")).toBeNull();
  });
});

describe("isDriverChatAvailable — shipment chat exists only after acceptance", () => {
  it("no conversation during the pre-acceptance states: New (back with dispatch) and Assigned (awaiting accept/decline)", () => {
    expect(isDriverChatAvailable("New")).toBe(false);
    expect(isDriverChatAvailable("Assigned")).toBe(false);
  });

  it("available from acceptance through the whole operational Land workflow", () => {
    for (const status of ["Accepted", "Loading", "Loaded", "In Transit", "Border Crossing", "Customs Clearance", "Arrived", "Delivered"] as const) {
      expect(isDriverChatAvailable(status)).toBe(true);
    }
  });

  it("stays available (read-only history) after the terminal statuses — closing never hides the conversation", () => {
    expect(isDriverChatAvailable("Closed")).toBe(true);
    expect(isDriverChatAvailable("Completed")).toBe(true);
  });

  it("sea/air operational statuses are chat-available (their sequences have no separate accept step)", () => {
    for (const status of ["Booking Confirmed", "Loaded on Vessel", "Out for Delivery"] as const) {
      expect(isDriverChatAvailable(status)).toBe(true);
    }
  });
});

describe("countUnreadChatForShipment", () => {
  const base: Omit<AppNotification, "id" | "shipmentId" | "type" | "readByUserIds"> = {
    shipmentNumber: "SH-1",
    titleEn: "t", titleTr: "t", titleAr: "t",
    messageEn: "m", messageTr: "m", messageAr: "m",
    timestamp: "2026-01-01T00:00:00.000Z",
    read: false,
  };
  const notif = (id: string, shipmentId: string, type: AppNotification["type"], readByUserIds?: string[]): AppNotification =>
    ({ ...base, id, shipmentId, type, readByUserIds });

  it("counts only unread chat notifications for the given shipment and user", () => {
    const notifications = [
      notif("1", "s1", "chat"),
      notif("2", "s1", "chat", ["driver-1"]),
      notif("3", "s1", "status_update"),
      notif("4", "s2", "chat"),
    ];
    expect(countUnreadChatForShipment(notifications, "s1", "driver-1")).toBe(1);
    expect(countUnreadChatForShipment(notifications, "s2", "driver-1")).toBe(1);
    expect(countUnreadChatForShipment(notifications, "s1", "driver-2")).toBe(2);
  });
});
