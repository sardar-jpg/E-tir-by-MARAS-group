import { describe, it, expect } from "vitest";
import { buildSeenScopeFilters, planSeenWrites } from "./chatSeenPlan";
import { resolveSeenChannelFilter } from "./chatVisibility";
import { isMessageUnreadForAdmin } from "./chatUnreadAccess";
import { applyMemoryFilters, type PageFilter } from "./pagination";
import type { ChatMessage } from "../types";

function msg(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "shipmentId" | "sender">): ChatMessage {
  return {
    senderName: "Test",
    type: "text",
    text: "hi",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildSeenScopeFilters", () => {
  it("scopes to shipmentId only when there is no channel restriction (admin, no channel specified)", () => {
    expect(buildSeenScopeFilters("ship-A", null)).toEqual([{ field: "shipmentId", op: "==", value: "ship-A" }]);
  });

  it("scopes to both shipmentId and channel when a channel restriction applies", () => {
    expect(buildSeenScopeFilters("ship-A", "driver_admin")).toEqual([
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ]);
  });

  it("combined with applyMemoryFilters, excludes every other shipment and channel — no cross-shipment/cross-channel leakage", () => {
    const messages: ChatMessage[] = [
      msg({ id: "a", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" }),
      msg({ id: "b", shipmentId: "ship-A", sender: "client", channel: "client_admin" }), // wrong channel
      msg({ id: "c", shipmentId: "ship-B", sender: "driver", channel: "driver_admin" }), // wrong shipment
      msg({ id: "d", shipmentId: "ship-A", sender: "admin", channel: "internal_staff" }), // wrong channel
    ];
    const filters = buildSeenScopeFilters("ship-A", "driver_admin");
    expect(applyMemoryFilters(messages, filters).map((m) => m.id)).toEqual(["a"]);
  });

  it("with no channel restriction, still never crosses into another shipment", () => {
    const messages: ChatMessage[] = [
      msg({ id: "a", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" }),
      msg({ id: "b", shipmentId: "ship-A", sender: "client", channel: "client_admin" }),
      msg({ id: "c", shipmentId: "ship-B", sender: "driver", channel: "driver_admin" }), // wrong shipment
    ];
    const filters = buildSeenScopeFilters("ship-A", null);
    expect(applyMemoryFilters(messages, filters).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("planSeenWrites — driver/client viewer", () => {
  it("marks an unread admin message as seen for a driver viewer", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "admin", channel: "driver_admin", status: "sent" })];
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes).toEqual([{ id: "m1", data: { ...candidates[0], status: "seen" } }]);
  });

  it("does not touch the driver's own message", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "sent" })];
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes).toEqual([]);
  });

  it("does not re-write an already-seen message", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "admin", channel: "driver_admin", status: "seen" })];
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes).toEqual([]);
  });

  it("a client viewer only ever touches client_admin messages, ignoring an unrelated driver_admin candidate", () => {
    const candidates = [
      msg({ id: "admin-msg", shipmentId: "ship-A", sender: "admin", channel: "client_admin", status: "sent" }),
      msg({ id: "driver-msg", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "sent" }), // out of scope, defense-in-depth
    ];
    const writes = planSeenWrites(candidates, { viewer: "client", channelFilter: "client_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes.map((w) => w.id)).toEqual(["admin-msg"]);
  });

  it("does not leak into a message from a different shipment even if it slips into the candidate list (defense in depth)", () => {
    const candidates = [
      msg({ id: "same-shipment", shipmentId: "ship-A", sender: "admin", channel: "driver_admin", status: "sent" }),
      msg({ id: "other-shipment", shipmentId: "ship-B", sender: "admin", channel: "driver_admin", status: "sent" }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes.map((w) => w.id)).toEqual(["same-shipment"]);
  });

  it("does not leak into a different channel's message even if it slips into the candidate list (defense in depth)", () => {
    const candidates = [
      msg({ id: "driver-channel", shipmentId: "ship-A", sender: "admin", channel: "driver_admin", status: "sent" }),
      msg({ id: "internal-channel", shipmentId: "ship-A", sender: "admin", channel: "internal_staff", status: "sent" }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: null });
    expect(writes.map((w) => w.id)).toEqual(["driver-channel"]);
  });
});

describe("planSeenWrites — admin viewer (per-user read state)", () => {
  it("marks a driver's message as seen and read by this admin, leaving other admins' read state untouched", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "sent" })];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes).toHaveLength(1);
    expect(writes[0].data.status).toBe("seen");
    expect(writes[0].data.readByAdminIds).toEqual(["admin-1"]);
    // The write only ever appends this admin — it never fabricates another admin as having read it.
    expect(isMessageUnreadForAdmin(writes[0].data, "admin-2")).toBe(true);
    expect(isMessageUnreadForAdmin(writes[0].data, "admin-1")).toBe(false);
  });

  it("appends to an existing readByAdminIds list instead of overwriting other admins' read state", () => {
    const candidates = [
      msg({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "seen", readByAdminIds: ["admin-2"] }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes[0].data.readByAdminIds).toEqual(["admin-2", "admin-1"]);
  });

  it("does not write anything when this admin has already read the message and it's already globally seen", () => {
    const candidates = [
      msg({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "seen", readByAdminIds: ["admin-1"] }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes).toEqual([]);
  });

  it("never marks this admin's own message as read by themselves", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "admin", senderId: "admin-1", channel: "internal_staff", status: "sent" })];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "internal_staff", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes).toEqual([]);
  });

  it("marks another admin's internal_staff message as read by this admin (per-admin unread, not a single shared flag)", () => {
    const candidates = [msg({ id: "m1", shipmentId: "ship-A", sender: "admin", senderId: "admin-2", channel: "internal_staff", status: "sent" })];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "internal_staff", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes).toHaveLength(1);
    expect(writes[0].data.readByAdminIds).toEqual(["admin-1"]);
  });

  it("only scopes to the shipment+channel the admin actually opened, never a different shipment or channel (defense in depth)", () => {
    const candidates = [
      msg({ id: "in-scope", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "sent" }),
      msg({ id: "other-shipment", shipmentId: "ship-B", sender: "driver", channel: "driver_admin", status: "sent" }),
      msg({ id: "other-channel", shipmentId: "ship-A", sender: "client", channel: "client_admin", status: "sent" }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes.map((w) => w.id)).toEqual(["in-scope"]);
  });

  it("preserves every other field on the message when writing (full-document replace, not a partial patch)", () => {
    const candidates = [
      msg({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", status: "sent", text: "hello there", fileUrl: undefined }),
    ];
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter: "driver_admin", shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes[0].data.text).toBe("hello there");
    expect(writes[0].data.shipmentId).toBe("ship-A");
    expect(writes[0].data.sender).toBe("driver");
  });
});

describe("planSeenWrites — resolveSeenChannelFilter integration (driver/client/admin visibility)", () => {
  // All three admin-sent by admin-2 (a different admin than the viewer in
  // the admin-viewer tests below), so they're eligible to be marked read
  // by admin-1 regardless of channel — isolating what's under test here
  // (channel scoping per role) from the separate "never marks own message"
  // rule already covered above.
  const candidates = [
    msg({ id: "driver-msg", shipmentId: "ship-A", sender: "admin", senderId: "admin-2", channel: "driver_admin", status: "sent" }),
    msg({ id: "client-msg", shipmentId: "ship-A", sender: "admin", senderId: "admin-2", channel: "client_admin", status: "sent" }),
    msg({ id: "internal-msg", shipmentId: "ship-A", sender: "admin", senderId: "admin-2", channel: "internal_staff", status: "sent" }),
  ];

  it("a driver session only ever marks driver_admin messages as seen, regardless of a requested channel", () => {
    const channelFilter = resolveSeenChannelFilter("driver", "internal_staff");
    const writes = planSeenWrites(candidates, { viewer: "driver", channelFilter, shipmentId: "ship-A", viewerAdminId: null });
    expect(writes.map((w) => w.id)).toEqual(["driver-msg"]);
  });

  it("a client session only ever marks client_admin messages as seen, regardless of a requested channel", () => {
    const channelFilter = resolveSeenChannelFilter("client", "internal_staff");
    const writes = planSeenWrites(candidates, { viewer: "client", channelFilter, shipmentId: "ship-A", viewerAdminId: null });
    expect(writes.map((w) => w.id)).toEqual(["client-msg"]);
  });

  it("an admin with no channel specified marks every channel's messages (matches the merged admin GET default)", () => {
    const channelFilter = resolveSeenChannelFilter("admin");
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter, shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes.map((w) => w.id).sort()).toEqual(["client-msg", "driver-msg", "internal-msg"]);
  });

  it("an admin explicitly opening one channel only marks that channel", () => {
    const channelFilter = resolveSeenChannelFilter("admin", "internal_staff");
    const writes = planSeenWrites(candidates, { viewer: "admin", channelFilter, shipmentId: "ship-A", viewerAdminId: "admin-1" });
    expect(writes.map((w) => w.id)).toEqual(["internal-msg"]);
  });
});
