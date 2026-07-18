import { describe, it, expect } from "vitest";
import { filterShipmentsBySearch, summarizeUnreadForShipment, shipmentRouteLabel, countUnreadForChannel, sortShipmentsByChatActivity, resolveShipmentChatActivityAt, indexNewestUnreadByShipment } from "./chatCenterView";
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

describe("sortShipmentsByChatActivity — WhatsApp-style recent-activity ordering (feature/admin-chat-recent-activity-order)", () => {
  type Row = { id: string; createdAt: string; lastChatActivityAt?: string; shipmentNumber: string };
  const ship = (id: string, createdAt: string, lastChatActivityAt?: string): Row =>
    ({ id, createdAt, ...(lastChatActivityAt ? { lastChatActivityAt } : {}), shipmentNumber: `MAR-${id}` });
  const unread = (shipmentId: string, timestamp: string, channel?: ChatMessage["channel"]): ChatMessage =>
    ({ id: `${shipmentId}-${timestamp}`, shipmentId, sender: "driver", senderName: "D", type: "text", text: "x", timestamp, ...(channel ? { channel } : {}) } as ChatMessage);

  it("the Order with the newest activity appears first — regardless of creation order", () => {
    const rows = [ship("a", "2026-01-01", "2026-07-01"), ship("b", "2026-06-01", "2026-07-18"), ship("c", "2026-05-01", "2026-07-10")];
    expect(sortShipmentsByChatActivity(rows, [], {}).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("activity from EACH of the three channels reorders the same Order equally", () => {
    for (const ch of ["internal_staff", "driver_admin", "client_admin"] as const) {
      const rows = [ship("old", "2026-06-01", "2026-07-01"), ship("bumped", "2026-01-01", "2026-02-01")];
      const sorted = sortShipmentsByChatActivity(rows, [unread("bumped", "2026-07-18T10:00:00Z", ch)], {});
      expect(sorted[0].id).toBe("bumped");
    }
  });

  it("the current admin's own send reorders immediately via localActivity", () => {
    const rows = [ship("other", "2026-06-01", "2026-07-15"), ship("mine", "2026-01-01", "2026-03-01")];
    expect(sortShipmentsByChatActivity(rows, [], {}).map((s) => s.id)).toEqual(["other", "mine"]);
    expect(sortShipmentsByChatActivity(rows, [], { mine: "2026-07-18T11:00:00Z" }).map((s) => s.id)).toEqual(["mine", "other"]);
  });

  it("another sender's message reorders when the unread poll delivers it (before the shipment record refreshes)", () => {
    const rows = [ship("a", "2026-06-01", "2026-07-15"), ship("b", "2026-01-01", "2026-03-01")];
    const sorted = sortShipmentsByChatActivity(rows, [unread("b", "2026-07-18T09:00:00Z", "client_admin")], {});
    expect(sorted[0].id).toBe("b");
  });

  it("reading/clearing unread does NOT demote: the server field keeps the position", () => {
    const rows = [ship("read-me", "2026-01-01", "2026-07-18T09:00:00Z"), ship("other", "2026-06-01", "2026-07-10")];
    const before = sortShipmentsByChatActivity(rows, [unread("read-me", "2026-07-18T09:00:00Z")], {});
    const afterRead = sortShipmentsByChatActivity(rows, [], {}); // unread cleared
    expect(before.map((s) => s.id)).toEqual(afterRead.map((s) => s.id));
    expect(afterRead[0].id).toBe("read-me");
  });

  it("reading a LEGACY Order (no lastChatActivityAt) does not demote either — localActivity remembers the thread's newest message", () => {
    const rows = [ship("legacy", "2026-01-01"), ship("other", "2026-02-01", "2026-07-01")];
    const whileUnread = sortShipmentsByChatActivity(rows, [unread("legacy", "2026-07-18T09:00:00Z")], {});
    expect(whileUnread[0].id).toBe("legacy");
    // Opening the thread recorded the newest message locally; unread then cleared.
    const afterRead = sortShipmentsByChatActivity(rows, [], { legacy: "2026-07-18T09:00:00Z" });
    expect(afterRead[0].id).toBe("legacy");
  });

  it("missing lastChatActivityAt never hides an Order — it falls back below Orders with known activity, by createdAt desc", () => {
    const rows = [ship("noact-old", "2026-01-01"), ship("active", "2026-03-01", "2026-07-01"), ship("noact-new", "2026-05-01")];
    const sorted = sortShipmentsByChatActivity(rows, [], {});
    expect(sorted.map((s) => s.id)).toEqual(["active", "noact-new", "noact-old"]);
  });

  it("deterministic tie-breaks: equal activity -> createdAt desc -> shipmentId ascending", () => {
    const t = "2026-07-18T10:00:00Z";
    const rows = [ship("b", "2026-05-01", t), ship("a", "2026-05-01", t), ship("c", "2026-06-01", t)];
    expect(sortShipmentsByChatActivity(rows, [], {}).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("search filters first and the surviving rows keep the same recent-activity order", () => {
    const rows = [ship("a", "2026-01-01", "2026-07-18"), ship("b", "2026-02-01", "2026-07-01"), ship("c", "2026-03-01", "2026-07-10")];
    const filtered = filterShipmentsBySearch(rows, "MAR-");
    const sorted = sortShipmentsByChatActivity(filtered, [], {});
    expect(sorted.map((s) => s.id)).toEqual(["a", "c", "b"]);
    const narrow = sortShipmentsByChatActivity(filterShipmentsBySearch(rows, "MAR-b"), [], {});
    expect(narrow.map((s) => s.id)).toEqual(["b"]);
  });

  it("never duplicates or drops a row, and never mutates the input", () => {
    const rows = [ship("a", "2026-01-01", "2026-07-01"), ship("b", "2026-02-01"), ship("c", "2026-03-01", "2026-06-01")];
    const inputOrder = rows.map((s) => s.id);
    const sorted = sortShipmentsByChatActivity(rows, [unread("b", "2026-07-18T09:00:00Z")], { a: "2026-07-19T00:00:00Z" });
    expect([...sorted.map((s) => s.id)].sort()).toEqual(["a", "b", "c"]);
    expect(new Set(sorted.map((s) => s.id)).size).toBe(3);
    expect(rows.map((s) => s.id)).toEqual(inputOrder);
  });

  it("resolveShipmentChatActivityAt takes the MAXIMUM of the three sources", () => {
    const idx = indexNewestUnreadByShipment([unread("s1", "2026-07-10T00:00:00Z"), unread("s1", "2026-07-12T00:00:00Z")]);
    expect(resolveShipmentChatActivityAt({ id: "s1", lastChatActivityAt: "2026-07-11T00:00:00Z" }, idx, { s1: "2026-07-09T00:00:00Z" })).toBe("2026-07-12T00:00:00Z");
    expect(resolveShipmentChatActivityAt({ id: "s2" }, idx, {})).toBeNull();
  });
});
