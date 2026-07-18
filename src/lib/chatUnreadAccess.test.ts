import { describe, it, expect } from "vitest";
import {
  isMessageFromOtherAdmin,
  isMessageUnreadForAdmin,
  appendAdminReader,
  formatUnreadBadge,
  selectUnreadMessagesForAdmin,
  buildAdminChatUnreadRecordId,
  resolveUnreadFanoutRecipientIds,
  planUnreadFanout,
  selectUnreadMessagesFromRecords,
  buildUnreadClearFilters,
  resolveLegacyUnreadAudience,
  selectChannellessClearableRecordIds,
  dropSeenUnreadMessages,
  applyUnreadPollResponse,
  type AdminChatUnreadRecord,
  type ConfirmedSeenScope,
} from "./chatUnreadAccess";
import { applyMemoryFilters, paginateDescending, walkAllDescendingPages, type PageCursor, type DescendingPageFetchResult } from "./pagination";
import type { ChatMessage } from "../types";

describe("isMessageFromOtherAdmin", () => {
  it("is always true for driver/client messages", () => {
    expect(isMessageFromOtherAdmin({ sender: "driver" }, "admin-a")).toBe(true);
    expect(isMessageFromOtherAdmin({ sender: "client" }, "admin-a")).toBe(true);
  });

  it("is true for another admin's message (different senderId)", () => {
    expect(isMessageFromOtherAdmin({ sender: "admin", senderId: "admin-b" }, "admin-a")).toBe(true);
  });

  it("is false for the viewer's own admin message", () => {
    expect(isMessageFromOtherAdmin({ sender: "admin", senderId: "admin-a" }, "admin-a")).toBe(false);
  });

  it("is false (conservative) for a legacy admin message with no senderId", () => {
    expect(isMessageFromOtherAdmin({ sender: "admin" }, "admin-a")).toBe(false);
  });
});

describe("isMessageUnreadForAdmin", () => {
  it("is true for another admin's unread internal_staff message", () => {
    expect(isMessageUnreadForAdmin({ sender: "admin", senderId: "admin-b" }, "admin-a")).toBe(true);
  });

  it("is false once this admin has read it", () => {
    expect(isMessageUnreadForAdmin({ sender: "admin", senderId: "admin-b", readByAdminIds: ["admin-a"] }, "admin-a")).toBe(false);
  });

  it("one admin reading does not clear another admin's unread state", () => {
    const msg = { sender: "admin" as const, senderId: "admin-b", readByAdminIds: ["admin-c"] };
    expect(isMessageUnreadForAdmin(msg, "admin-c")).toBe(false);
    expect(isMessageUnreadForAdmin(msg, "admin-a")).toBe(true);
  });

  it("is false for the viewer's own message regardless of readByAdminIds", () => {
    expect(isMessageUnreadForAdmin({ sender: "admin", senderId: "admin-a" }, "admin-a")).toBe(false);
  });

  it("driver/client messages are unread until this admin's id is in readByAdminIds", () => {
    expect(isMessageUnreadForAdmin({ sender: "driver" }, "admin-a")).toBe(true);
    expect(isMessageUnreadForAdmin({ sender: "driver", readByAdminIds: ["admin-a"] }, "admin-a")).toBe(false);
    expect(isMessageUnreadForAdmin({ sender: "driver", readByAdminIds: ["admin-b"] }, "admin-a")).toBe(true);
  });
});

describe("internal_staff multi-admin mark-seen scenario (regression for the ChatCenter.tsx mark-seen bug fix)", () => {
  // Every internal_staff message has sender: 'admin' — there is no "other
  // party" the way there is for driver_admin/client_admin. ChatCenter.tsx
  // used to gate its POST /chat/seen call on "does this channel have any
  // non-admin sender," which was always false for internal_staff, so
  // opening it never called /chat/seen at all and readByAdminIds could
  // never be updated. These tests exercise the actual per-message
  // eligibility logic (isMessageFromOtherAdmin / isMessageUnreadForAdmin /
  // appendAdminReader) the server applies once that call does happen —
  // the fix itself is "call unconditionally whenever there are messages,"
  // this proves the per-message logic it now actually gets a chance to
  // run is correct.
  it("Admin B opening internal_staff marks Admin A's message read for B", () => {
    const messageFromA = { sender: "admin" as const, senderId: "admin-a", readByAdminIds: [] as string[] };
    expect(isMessageUnreadForAdmin(messageFromA, "admin-b")).toBe(true);

    const nextReadBy = appendAdminReader(messageFromA.readByAdminIds, "admin-b");
    const afterBReads = { ...messageFromA, readByAdminIds: nextReadBy };

    expect(isMessageUnreadForAdmin(afterBReads, "admin-b")).toBe(false);
  });

  it("Admin A's own internal_staff message is never counted unread for A, before or after any mark-seen call", () => {
    const messageFromA = { sender: "admin" as const, senderId: "admin-a", readByAdminIds: [] as string[] };
    expect(isMessageUnreadForAdmin(messageFromA, "admin-a")).toBe(false);

    // Even if a mark-seen call somehow tried to add A as a reader of A's
    // own message (it shouldn't — isMessageFromOtherAdmin already
    // excludes this server-side), it would still never count as unread
    // for A.
    const withSelfAsReader = { ...messageFromA, readByAdminIds: appendAdminReader(messageFromA.readByAdminIds, "admin-a") };
    expect(isMessageUnreadForAdmin(withSelfAsReader, "admin-a")).toBe(false);
  });

  it("Admin B reading Admin A's internal_staff message does not mark it read for Admin C", () => {
    const messageFromA = { sender: "admin" as const, senderId: "admin-a", readByAdminIds: [] as string[] };
    const afterBReads = { ...messageFromA, readByAdminIds: appendAdminReader(messageFromA.readByAdminIds, "admin-b") };

    expect(isMessageUnreadForAdmin(afterBReads, "admin-b")).toBe(false);
    expect(isMessageUnreadForAdmin(afterBReads, "admin-c")).toBe(true);
  });
});

describe("appendAdminReader", () => {
  it("adds a new reader", () => {
    expect(appendAdminReader(undefined, "admin-a")).toEqual(["admin-a"]);
    expect(appendAdminReader(["admin-b"], "admin-a")).toEqual(["admin-b", "admin-a"]);
  });

  it("does not duplicate an existing reader", () => {
    expect(appendAdminReader(["admin-a"], "admin-a")).toEqual(["admin-a"]);
  });

  it("returns the same array reference when nothing changed (write-skip optimization)", () => {
    const existing = ["admin-a"];
    expect(appendAdminReader(existing, "admin-a")).toBe(existing);
  });
});

describe("selectUnreadMessagesForAdmin — GET /api/chat/unread's filter+sort (Phase 4 follow-up)", () => {
  interface Msg {
    id: string;
    sender: "admin" | "driver" | "client";
    senderId?: string;
    readByAdminIds?: string[];
    timestamp: string;
  }

  function dataset(): Msg[] {
    return [
      { id: "m1", sender: "driver", timestamp: "2026-01-01T00:00:00Z" },
      { id: "m2", sender: "admin", senderId: "admin-a", timestamp: "2026-01-01T00:05:00Z" }, // admin-a's own — never unread for admin-a
      { id: "m3", sender: "client", readByAdminIds: ["admin-a"], timestamp: "2026-01-01T00:10:00Z" }, // already read by admin-a
      { id: "m4", sender: "admin", senderId: "admin-b", timestamp: "2026-01-01T00:15:00Z" }, // admin-b's message — unread for admin-a
      { id: "m5", sender: "driver", timestamp: "2026-01-01T00:20:00Z" },
    ];
  }

  it("returns only messages unread for the given admin, newest first", () => {
    const result = selectUnreadMessagesForAdmin(dataset(), "admin-a");
    expect(result.map((m) => m.id)).toEqual(["m5", "m4", "m1"]);
  });

  it("gives a different admin a different unread set from the same data (per-user correctness)", () => {
    const resultA = selectUnreadMessagesForAdmin(dataset(), "admin-a");
    const resultB = selectUnreadMessagesForAdmin(dataset(), "admin-b");
    expect(resultA.map((m) => m.id)).toEqual(["m5", "m4", "m1"]);
    // admin-b hasn't read m1/m3/m5 either, but m4 is admin-b's own message (excluded), and m2 is admin-a's (still unread for b).
    expect(resultB.map((m) => m.id)).toEqual(["m5", "m3", "m2", "m1"]);
  });
});

describe("selectUnreadMessagesForAdmin + walkAllDescendingPages integration — cross-shipment unread, memory-fallback parity", () => {
  interface Msg {
    id: string;
    sender: "admin" | "driver" | "client";
    senderId?: string;
    shipmentId: string;
    readByAdminIds?: string[];
    timestamp: string;
  }

  function crossShipmentDataset(): Msg[] {
    return [
      { id: "s1-driver", sender: "driver", shipmentId: "ship-1", timestamp: "2026-01-01T00:00:00Z" },
      { id: "s2-admin-b", sender: "admin", senderId: "admin-b", shipmentId: "ship-2", timestamp: "2026-01-01T00:05:00Z" },
      { id: "s1-admin-a-own", sender: "admin", senderId: "admin-a", shipmentId: "ship-1", timestamp: "2026-01-01T00:10:00Z" },
      { id: "s3-client-read", sender: "client", shipmentId: "ship-3", readByAdminIds: ["admin-a"], timestamp: "2026-01-01T00:15:00Z" },
      { id: "s2-driver", sender: "driver", shipmentId: "ship-2", timestamp: "2026-01-01T00:20:00Z" },
    ];
  }

  function makeFetcher(items: Msg[], pageLimit: number) {
    return async (cursor: PageCursor | null): Promise<DescendingPageFetchResult<Msg>> => {
      // No filters — matches GET /api/chat/unread's admin-wide (cross-shipment, cross-channel) scope.
      const page = paginateDescending(applyMemoryFilters(items, []), (i) => i.timestamp, (i) => i.id, { cursor, limit: pageLimit });
      return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    };
  }

  it("computes the correct cross-shipment unread set for one admin regardless of how the underlying walk is chunked", async () => {
    const viaOnePage = selectUnreadMessagesForAdmin(await walkAllDescendingPages(makeFetcher(crossShipmentDataset(), 50)), "admin-a");
    const viaChunkedWalk = selectUnreadMessagesForAdmin(await walkAllDescendingPages(makeFetcher(crossShipmentDataset(), 1)), "admin-a");

    expect(viaOnePage.map((m) => m.id)).toEqual(["s2-driver", "s2-admin-b", "s1-driver"]);
    expect(viaChunkedWalk.map((m) => m.id)).toEqual(viaOnePage.map((m) => m.id));
  });

  it("never restricts the unread set to one shipment — admin unread is intentionally global, unlike /chat/seen", async () => {
    const result = selectUnreadMessagesForAdmin(await walkAllDescendingPages(makeFetcher(crossShipmentDataset(), 2)), "admin-a");
    const shipmentIds = new Set(result.map((m) => m.shipmentId));
    expect(shipmentIds.has("ship-1")).toBe(true);
    expect(shipmentIds.has("ship-2")).toBe(true);
  });
});

function chatMessage(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "shipmentId" | "sender">): ChatMessage {
  return {
    senderName: "Test",
    type: "text",
    text: "hi",
    timestamp: "2026-01-01T00:00:00Z",
    status: "sent",
    ...overrides,
  };
}

describe("buildAdminChatUnreadRecordId", () => {
  it("is deterministic for the same (adminId, messageId) pair", () => {
    expect(buildAdminChatUnreadRecordId("admin-a", "msg-1")).toBe(buildAdminChatUnreadRecordId("admin-a", "msg-1"));
  });

  it("differs for different admins or different messages", () => {
    expect(buildAdminChatUnreadRecordId("admin-a", "msg-1")).not.toBe(buildAdminChatUnreadRecordId("admin-b", "msg-1"));
    expect(buildAdminChatUnreadRecordId("admin-a", "msg-1")).not.toBe(buildAdminChatUnreadRecordId("admin-a", "msg-2"));
  });
});

describe("resolveUnreadFanoutRecipientIds (chat-unread scalability follow-up — write-time fan-out)", () => {
  it("driver/client messages create unread state for every eligible admin", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" });
    expect(resolveUnreadFanoutRecipientIds(["admin-a", "admin-b"], message).sort()).toEqual(["admin-a", "admin-b"]);
  });

  it("an admin never gets fanned out their own message", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "admin", senderId: "admin-a", channel: "internal_staff" });
    expect(resolveUnreadFanoutRecipientIds(["admin-a", "admin-b"], message)).toEqual(["admin-b"]);
  });

  it("another admin's message fans out to every OTHER eligible admin, not just one", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "admin", senderId: "admin-a", channel: "internal_staff" });
    expect(resolveUnreadFanoutRecipientIds(["admin-a", "admin-b", "admin-c"], message).sort()).toEqual(["admin-b", "admin-c"]);
  });

  it("a legacy admin message with no senderId fans out to nobody (conservative, matches isMessageFromOtherAdmin)", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "admin", channel: "internal_staff" });
    expect(resolveUnreadFanoutRecipientIds(["admin-a", "admin-b"], message)).toEqual([]);
  });

  it("deduplicates a caller-supplied admin roster with a repeated id", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver" });
    expect(resolveUnreadFanoutRecipientIds(["admin-a", "admin-a", "admin-b"], message).sort()).toEqual(["admin-a", "admin-b"]);
  });
});

describe("planUnreadFanout", () => {
  it("builds one full record per recipient, embedding the exact message snapshot", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin", text: "hello" });
    const records = planUnreadFanout(["admin-a", "admin-b"], message, "2026-01-02T00:00:00Z");

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id).sort()).toEqual([
      buildAdminChatUnreadRecordId("admin-a", "m1"),
      buildAdminChatUnreadRecordId("admin-b", "m1"),
    ].sort());
    const forA = records.find((r) => r.adminId === "admin-a")!;
    expect(forA.messageId).toBe("m1");
    expect(forA.shipmentId).toBe("ship-A");
    expect(forA.channel).toBe("driver_admin");
    expect(forA.timestamp).toBe(message.timestamp);
    expect(forA.createdAt).toBe("2026-01-02T00:00:00Z");
    expect(forA.message).toEqual(message);
  });

  it("is idempotent: planning the same message twice yields the same record ids (a retry is a same-content overwrite, never a duplicate)", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver" });
    const first = planUnreadFanout(["admin-a", "admin-b"], message, "2026-01-02T00:00:00Z");
    const second = planUnreadFanout(["admin-a", "admin-b"], message, "2026-01-02T00:00:00Z");
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
  });

  it("produces zero records for a legacy senderId-less admin message (nobody eligible)", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "admin", channel: "internal_staff" });
    expect(planUnreadFanout(["admin-a", "admin-b"], message, "2026-01-02T00:00:00Z")).toEqual([]);
  });
});

describe("selectUnreadMessagesFromRecords (GET /api/chat/unread's response shaping)", () => {
  function record(overrides: Partial<AdminChatUnreadRecord> & Pick<AdminChatUnreadRecord, "id" | "adminId" | "message">): AdminChatUnreadRecord {
    return {
      messageId: overrides.message.id,
      shipmentId: overrides.message.shipmentId,
      channel: overrides.message.channel,
      timestamp: overrides.message.timestamp,
      createdAt: overrides.message.timestamp,
      ...overrides,
    };
  }

  it("unwraps this admin's records into their embedded ChatMessage snapshots", () => {
    const m1 = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver" });
    const records = [record({ id: buildAdminChatUnreadRecordId("admin-a", "m1"), adminId: "admin-a", message: m1 })];
    expect(selectUnreadMessagesFromRecords(records, "admin-a")).toEqual([m1]);
  });

  it("Admin A reading a message does not affect Admin B's still-unread record for the same message (per-admin, no cross-admin leakage)", () => {
    const m1 = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver" });
    // Admin A already called /chat/seen for this message — its record was
    // deleted server-side, so only Admin B's record still exists.
    const records = [record({ id: buildAdminChatUnreadRecordId("admin-b", "m1"), adminId: "admin-b", message: m1 })];

    expect(selectUnreadMessagesFromRecords(records, "admin-a")).toEqual([]);
    expect(selectUnreadMessagesFromRecords(records, "admin-b")).toEqual([m1]);
  });

  it("defense in depth: never returns a record whose adminId does not match the viewer, even if one slips into the candidate list", () => {
    const m1 = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver" });
    const records = [record({ id: buildAdminChatUnreadRecordId("admin-b", "m1"), adminId: "admin-b", message: m1 })];
    expect(selectUnreadMessagesFromRecords(records, "admin-a")).toEqual([]);
  });

  it("defense in depth: excludes a record for the viewer's own message even if one somehow exists", () => {
    const ownMessage = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "admin", senderId: "admin-a", channel: "internal_staff" });
    const records = [record({ id: buildAdminChatUnreadRecordId("admin-a", "m1"), adminId: "admin-a", message: ownMessage })];
    expect(selectUnreadMessagesFromRecords(records, "admin-a")).toEqual([]);
  });
});

describe("buildUnreadClearFilters (POST /chat/seen's adminChatUnread scope — no cross-admin/shipment/channel leakage)", () => {
  it("scopes to this admin + shipment only when no channel restriction applies", () => {
    expect(buildUnreadClearFilters("admin-a", "ship-A", null)).toEqual([
      { field: "adminId", op: "==", value: "admin-a" },
      { field: "shipmentId", op: "==", value: "ship-A" },
    ]);
  });

  it("adds the channel restriction when one applies", () => {
    expect(buildUnreadClearFilters("admin-a", "ship-A", "driver_admin")).toEqual([
      { field: "adminId", op: "==", value: "admin-a" },
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ]);
  });

  it("combined with applyMemoryFilters, clears only this admin's records in the exact shipment+channel scope — never another admin's, shipment's, or channel's", () => {
    const m1 = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" });
    const records: AdminChatUnreadRecord[] = [
      { id: "r1", adminId: "admin-a", messageId: "m1", shipmentId: "ship-A", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp },
      { id: "r2", adminId: "admin-b", messageId: "m1", shipmentId: "ship-A", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // wrong admin
      { id: "r3", adminId: "admin-a", messageId: "m2", shipmentId: "ship-B", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // wrong shipment
      { id: "r4", adminId: "admin-a", messageId: "m3", shipmentId: "ship-A", channel: "client_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // wrong channel
    ];
    const filters = buildUnreadClearFilters("admin-a", "ship-A", "driver_admin");
    expect(applyMemoryFilters(records, filters).map((r) => r.id)).toEqual(["r1"]);
  });

  it("with no channel restriction, still never crosses into another admin or shipment", () => {
    const m1 = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" });
    const records: AdminChatUnreadRecord[] = [
      { id: "r1", adminId: "admin-a", messageId: "m1", shipmentId: "ship-A", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp },
      { id: "r2", adminId: "admin-a", messageId: "m2", shipmentId: "ship-A", channel: "client_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // same admin+shipment, different channel — still cleared
      { id: "r3", adminId: "admin-b", messageId: "m1", shipmentId: "ship-A", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // wrong admin
      { id: "r4", adminId: "admin-a", messageId: "m3", shipmentId: "ship-B", channel: "driver_admin", timestamp: m1.timestamp, message: m1, createdAt: m1.timestamp }, // wrong shipment
    ];
    const filters = buildUnreadClearFilters("admin-a", "ship-A", null);
    expect(applyMemoryFilters(records, filters).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("adminChatUnread end-to-end scenario (write fan-out -> seen deletion -> read), memory-fallback parity", () => {
  function toRecords(message: ChatMessage, recipientAdminIds: string[]): AdminChatUnreadRecord[] {
    return planUnreadFanout(recipientAdminIds, message, message.timestamp);
  }

  it("Admin A reads a message; Admin B still sees it unread", () => {
    const message = chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", channel: "driver_admin" });
    let store = toRecords(message, ["admin-a", "admin-b"]);

    // Admin A calls /chat/seen for ship-A/driver_admin — its own records in that scope are deleted.
    const clearFilters = buildUnreadClearFilters("admin-a", "ship-A", "driver_admin");
    const toDelete = new Set(applyMemoryFilters(store, clearFilters).map((r) => r.id));
    store = store.filter((r) => !toDelete.has(r.id));

    expect(selectUnreadMessagesFromRecords(store.filter((r) => r.adminId === "admin-a"), "admin-a")).toEqual([]);
    expect(selectUnreadMessagesFromRecords(store.filter((r) => r.adminId === "admin-b"), "admin-b")).toEqual([message]);
  });

  it("cursor pagination (chunked walk) never skips or duplicates one admin's unread records, matching a single-page fetch", async () => {
    const messages = [
      chatMessage({ id: "m1", shipmentId: "ship-A", sender: "driver", timestamp: "2026-01-01T00:00:00Z" }),
      chatMessage({ id: "m2", shipmentId: "ship-B", sender: "client", timestamp: "2026-01-01T00:05:00Z" }),
      chatMessage({ id: "m3", shipmentId: "ship-A", sender: "admin", senderId: "admin-b", channel: "internal_staff", timestamp: "2026-01-01T00:10:00Z" }),
    ];
    const records = messages.flatMap((m) => toRecords(m, ["admin-a", "admin-b"]));
    const forAdminA = applyMemoryFilters(records, [{ field: "adminId", op: "==", value: "admin-a" }]);

    function makeFetcher(items: AdminChatUnreadRecord[], pageLimit: number) {
      return async (cursor: PageCursor | null): Promise<DescendingPageFetchResult<AdminChatUnreadRecord>> => {
        const page = paginateDescending(items, (i) => i.timestamp, (i) => i.id, { cursor, limit: pageLimit });
        return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
      };
    }

    const viaOnePage = await walkAllDescendingPages(makeFetcher(forAdminA, 50));
    const viaChunkedWalk = await walkAllDescendingPages(makeFetcher(forAdminA, 1));

    expect(viaChunkedWalk).toHaveLength(viaOnePage.length);
    expect(new Set(viaChunkedWalk.map((r) => r.id))).toEqual(new Set(viaOnePage.map((r) => r.id)));
    expect(selectUnreadMessagesFromRecords(viaOnePage, "admin-a").map((m) => m.id).sort()).toEqual(["m1", "m2", "m3"]);
  });
});

describe("formatUnreadBadge", () => {
  it("hides the badge at 0 (and below)", () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(-1)).toBeNull();
  });

  it("shows the exact count from 1 to 99", () => {
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(42)).toBe("42");
    expect(formatUnreadBadge(99)).toBe("99");
  });

  it("caps display at 99+ above 99", () => {
    expect(formatUnreadBadge(100)).toBe("99+");
    expect(formatUnreadBadge(500)).toBe("99+");
  });
});

// ── fix/admin-mobile-chat-correctness: legacy channel-less records ──

const legacyRecord = (
  id: string,
  adminId: string,
  shipmentId: string,
  sender: "driver" | "client" | "admin",
  channel?: ChatMessage["channel"]
): AdminChatUnreadRecord => ({
  id,
  adminId,
  messageId: id.split("__")[1] || id,
  shipmentId,
  ...(channel ? { channel } : {}),
  timestamp: "2026-05-31T10:00:00Z",
  message: {
    id: id.split("__")[1] || id,
    shipmentId,
    sender,
    senderName: sender,
    senderId: sender === "admin" ? "some-other-admin" : undefined,
    type: "text",
    text: "hello",
    timestamp: "2026-05-31T10:00:00Z",
    ...(channel ? { channel } : {}),
  } as ChatMessage,
  createdAt: "2026-05-31T10:00:00Z",
});

describe("resolveLegacyUnreadAudience — deterministic audience of a channel-less message", () => {
  it("driver-sent resolves to driver_admin, client-sent to client_admin", () => {
    expect(resolveLegacyUnreadAudience({ sender: "driver" })).toBe("driver_admin");
    expect(resolveLegacyUnreadAudience({ sender: "client" })).toBe("client_admin");
  });

  it("admin-sent is AMBIGUOUS — never silently attributed to any channel", () => {
    expect(resolveLegacyUnreadAudience({ sender: "admin" })).toBe("ambiguous_legacy_admin_message");
  });
});

describe("selectChannellessClearableRecordIds — what a channel-scoped seen may additionally clear", () => {
  const admin = "admin-a";
  const ship = "shipment-1001";
  const records: AdminChatUnreadRecord[] = [
    legacyRecord("admin-a__m1", admin, ship, "driver"),            // channel-less driver → driver_admin
    legacyRecord("admin-a__m2", admin, ship, "client"),            // channel-less client → client_admin
    legacyRecord("admin-a__m3", admin, ship, "admin"),             // channel-less admin → ambiguous
    legacyRecord("admin-a__m4", admin, ship, "driver", "driver_admin"), // HAS channel — not this helper's job
    legacyRecord("admin-b__m1", "admin-b", ship, "driver"),        // another admin
    legacyRecord("admin-a__m5", admin, "shipment-9999", "driver"), // another shipment
  ];

  it("a channel-less DRIVER record clears only from driver_admin", () => {
    expect(selectChannellessClearableRecordIds(records, admin, ship, "driver_admin")).toEqual(["admin-a__m1"]);
    expect(selectChannellessClearableRecordIds(records, admin, ship, "client_admin")).toEqual(["admin-a__m2"]);
  });

  it("a channel-less CLIENT record never clears from driver_admin or internal_staff", () => {
    expect(selectChannellessClearableRecordIds(records, admin, ship, "internal_staff")).toEqual([]);
  });

  it("an ambiguous legacy admin record is never cleared from ANY channel", () => {
    for (const ch of ["driver_admin", "client_admin", "internal_staff"] as const) {
      expect(selectChannellessClearableRecordIds(records, admin, ship, ch)).not.toContain("admin-a__m3");
    }
  });

  it("never touches another admin's records or another shipment's records", () => {
    const ids = selectChannellessClearableRecordIds(records, admin, ship, "driver_admin");
    expect(ids).not.toContain("admin-b__m1");
    expect(ids).not.toContain("admin-a__m5");
  });

  it("records that already carry a channel are left to the channel-scoped query (never re-selected here)", () => {
    expect(selectChannellessClearableRecordIds(records, admin, ship, "driver_admin")).not.toContain("admin-a__m4");
  });
});

describe("dropSeenUnreadMessages — the confirmed local badge drop (shipment, channel, and global badges share this array)", () => {
  const msgs: ChatMessage[] = [
    { id: "m1", shipmentId: "s1", sender: "driver", senderName: "D", type: "text", text: "a", timestamp: "t", channel: "driver_admin" } as ChatMessage,
    { id: "m2", shipmentId: "s1", sender: "driver", senderName: "D", type: "text", text: "b", timestamp: "t" } as ChatMessage, // channel-less legacy driver
    { id: "m3", shipmentId: "s1", sender: "client", senderName: "C", type: "text", text: "c", timestamp: "t", channel: "client_admin" } as ChatMessage,
    { id: "m4", shipmentId: "s2", sender: "driver", senderName: "D", type: "text", text: "d", timestamp: "t", channel: "driver_admin" } as ChatMessage,
    { id: "m5", shipmentId: "s1", sender: "admin", senderName: "A", type: "text", text: "e", timestamp: "t" } as ChatMessage, // ambiguous legacy admin
  ];

  it("a successful driver_admin seen drops that channel's messages AND channel-less driver messages — nothing else", () => {
    const after = dropSeenUnreadMessages(msgs, "s1", "driver_admin");
    expect(after.map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
  });

  it("one shipment/channel read never clears another shipment's or channel's unread", () => {
    const after = dropSeenUnreadMessages(msgs, "s1", "client_admin");
    expect(after.map((m) => m.id)).toEqual(["m1", "m2", "m4", "m5"]);
  });

  it("an ambiguous legacy admin message is not silently cleared by any channel read", () => {
    for (const ch of ["driver_admin", "client_admin", "internal_staff"] as const) {
      expect(dropSeenUnreadMessages(msgs, "s1", ch).map((m) => m.id)).toContain("m5");
    }
  });
});

describe("applyUnreadPollResponse — a stale poll response cannot resurrect a cleared badge", () => {
  const fetched: ChatMessage[] = [
    { id: "m1", shipmentId: "s1", sender: "driver", senderName: "D", type: "text", text: "a", timestamp: "t", channel: "driver_admin" } as ChatMessage,
    { id: "m2", shipmentId: "s2", sender: "client", senderName: "C", type: "text", text: "b", timestamp: "t", channel: "client_admin" } as ChatMessage,
  ];

  it("drops messages in a scope whose seen was CONFIRMED AFTER the request was issued (the response predates the deletion)", () => {
    const scopes: ConfirmedSeenScope[] = [{ shipmentId: "s1", channel: "driver_admin", confirmedAt: 1_000 }];
    const applied = applyUnreadPollResponse(fetched, scopes, 500);
    expect(applied.map((m) => m.id)).toEqual(["m2"]);
  });

  it("does NOT re-apply a scope confirmed BEFORE the request was issued — a genuinely new message may appear again", () => {
    const scopes: ConfirmedSeenScope[] = [{ shipmentId: "s1", channel: "driver_admin", confirmedAt: 1_000 }];
    const applied = applyUnreadPollResponse(fetched, scopes, 2_000);
    expect(applied.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("with no confirmed scopes, the server response is applied verbatim (server-authoritative)", () => {
    expect(applyUnreadPollResponse(fetched, [], 0)).toEqual(fetched);
  });
});
