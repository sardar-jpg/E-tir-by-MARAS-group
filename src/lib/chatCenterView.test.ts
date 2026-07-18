import { describe, it, expect } from "vitest";
import { filterShipmentsBySearch, summarizeUnreadForShipment, shipmentRouteLabel, countUnreadForChannel } from "./chatCenterView";
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

describe("countUnreadForChannel — channel tab badges from the same authoritative unread array (fix/admin-mobile-chat-correctness)", () => {
  const msgs: ChatMessage[] = [
    { id: "m1", shipmentId: "s1", sender: "driver", senderName: "D", type: "text", text: "a", timestamp: "t", channel: "driver_admin" } as ChatMessage,
    { id: "m2", shipmentId: "s1", sender: "driver", senderName: "D", type: "text", text: "b", timestamp: "t" } as ChatMessage, // legacy channel-less driver
    { id: "m3", shipmentId: "s1", sender: "client", senderName: "C", type: "text", text: "c", timestamp: "t" } as ChatMessage, // legacy channel-less client
    { id: "m4", shipmentId: "s1", sender: "admin", senderName: "A", type: "text", text: "d", timestamp: "t", channel: "internal_staff" } as ChatMessage,
    { id: "m5", shipmentId: "s1", sender: "admin", senderName: "A", type: "text", text: "e", timestamp: "t" } as ChatMessage, // ambiguous legacy admin
    { id: "m6", shipmentId: "s2", sender: "driver", senderName: "D", type: "text", text: "f", timestamp: "t", channel: "driver_admin" } as ChatMessage,
  ];

  it("counts channel-tagged AND deterministically-resolved channel-less messages per channel", () => {
    expect(countUnreadForChannel(msgs, "s1", "driver_admin")).toBe(2);  // m1 + legacy driver m2
    expect(countUnreadForChannel(msgs, "s1", "client_admin")).toBe(1);  // legacy client m3
    expect(countUnreadForChannel(msgs, "s1", "internal_staff")).toBe(1); // m4 only
  });

  it("an ambiguous legacy admin message counts toward NO channel tab (opening a channel never clears it)", () => {
    const total =
      countUnreadForChannel(msgs, "s1", "driver_admin") +
      countUnreadForChannel(msgs, "s1", "client_admin") +
      countUnreadForChannel(msgs, "s1", "internal_staff");
    expect(total).toBe(4); // m5 in none of the three
    expect(summarizeUnreadForShipment(msgs, "s1").count).toBe(5); // but still in the shipment total
  });

  it("never counts another shipment's messages", () => {
    expect(countUnreadForChannel(msgs, "s2", "driver_admin")).toBe(1);
    expect(countUnreadForChannel(msgs, "s2", "client_admin")).toBe(0);
  });
});
