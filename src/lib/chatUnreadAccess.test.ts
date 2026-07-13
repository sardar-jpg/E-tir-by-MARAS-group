import { describe, it, expect } from "vitest";
import { isMessageFromOtherAdmin, isMessageUnreadForAdmin, appendAdminReader, formatUnreadBadge } from "./chatUnreadAccess";

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
