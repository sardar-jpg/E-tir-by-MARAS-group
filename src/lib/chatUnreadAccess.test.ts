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
