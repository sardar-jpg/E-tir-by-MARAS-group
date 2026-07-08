import { describe, it, expect } from "vitest";
import { filterShipmentsBySearch, summarizeUnreadForShipment, shipmentRouteLabel } from "./chatCenterView";
import type { ChatMessage } from "../types";

describe("filterShipmentsBySearch", () => {
  const shipments = [
    { shipmentNumber: "ETIR-2026-001" },
    { shipmentNumber: "ETIR-2026-002" },
    { shipmentNumber: "MARAS-0099" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterShipmentsBySearch(shipments, "")).toEqual(shipments);
    expect(filterShipmentsBySearch(shipments, "   ")).toEqual(shipments);
  });

  it("matches case-insensitively on a substring", () => {
    expect(filterShipmentsBySearch(shipments, "2026-001")).toEqual([shipments[0]]);
    expect(filterShipmentsBySearch(shipments, "etir-2026")).toEqual([shipments[0], shipments[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterShipmentsBySearch(shipments, "no-match")).toEqual([]);
  });
});

describe("summarizeUnreadForShipment", () => {
  const baseMsg: ChatMessage = {
    id: "m1",
    shipmentId: "s1",
    sender: "driver",
    senderName: "Driver A",
    type: "text",
    text: "hello",
    timestamp: "2026-01-01T00:00:00.000Z",
  };

  it("returns a zero summary when there are no unread messages for the shipment", () => {
    expect(summarizeUnreadForShipment([], "s1")).toEqual({ count: 0, lastMessage: null });
    expect(summarizeUnreadForShipment([{ ...baseMsg, shipmentId: "other" }], "s1")).toEqual({
      count: 0,
      lastMessage: null,
    });
  });

  it("counts only messages for the given shipment and picks the most recent as lastMessage", () => {
    const older = { ...baseMsg, id: "m1", timestamp: "2026-01-01T00:00:00.000Z", text: "older" };
    const newer = { ...baseMsg, id: "m2", timestamp: "2026-01-02T00:00:00.000Z", text: "newer" };
    const otherShipment = { ...baseMsg, id: "m3", shipmentId: "s2" };

    const result = summarizeUnreadForShipment([older, newer, otherShipment], "s1");
    expect(result.count).toBe(2);
    expect(result.lastMessage?.id).toBe("m2");
  });
});

describe("shipmentRouteLabel", () => {
  it("formats a loading -> delivery city route", () => {
    expect(shipmentRouteLabel({ loadingCity: "Istanbul", deliveryCity: "Baghdad" })).toBe(
      "Istanbul → Baghdad"
    );
  });
});
