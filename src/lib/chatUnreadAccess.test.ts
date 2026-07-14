import { describe, it, expect } from "vitest";
import {
  isMessageFromOtherAdmin,
  isMessageUnreadForAdmin,
  appendAdminReader,
  formatUnreadBadge,
  selectUnreadMessagesForAdmin,
} from "./chatUnreadAccess";
import { applyMemoryFilters, paginateDescending, walkAllDescendingPages, type PageCursor, type DescendingPageFetchResult } from "./pagination";

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
