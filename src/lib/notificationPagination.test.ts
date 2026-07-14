import { describe, it, expect } from "vitest";
import { mergeNewerNotifications, appendOlderNotifications } from "./notificationPagination";

describe("mergeNewerNotifications — Phase 4 (Firestore scalability audit)", () => {
  it("prepends newer notifications (notifications render newest-first)", () => {
    const existing = [{ id: "old-1" }, { id: "old-2" }];
    const result = mergeNewerNotifications(existing, [{ id: "new-1" }, { id: "new-2" }]);
    expect(result.map((n) => n.id)).toEqual(["new-1", "new-2", "old-1", "old-2"]);
  });

  it("never duplicates a notification that arrives twice", () => {
    const existing = [{ id: "a" }, { id: "b" }];
    const result = mergeNewerNotifications(existing, [{ id: "c" }, { id: "a" }]);
    expect(result.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("an empty delta is a safe no-op, returning the same array reference", () => {
    const existing = [{ id: "a" }];
    expect(mergeNewerNotifications(existing, [])).toBe(existing);
  });
});

describe("appendOlderNotifications — Phase 4 (Firestore scalability audit)", () => {
  it("appends older notifications after the existing (newest-first) list", () => {
    const existing = [{ id: "n1" }, { id: "n2" }];
    const result = appendOlderNotifications(existing, [{ id: "n3" }, { id: "n4" }]);
    expect(result.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("never duplicates a notification already present (e.g. a retried 'load more')", () => {
    const existing = [{ id: "n1" }, { id: "n2" }];
    const result = appendOlderNotifications(existing, [{ id: "n2" }, { id: "n3" }]);
    expect(result.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("an empty older page is a safe no-op, returning the same array reference", () => {
    const existing = [{ id: "a" }];
    expect(appendOlderNotifications(existing, [])).toBe(existing);
  });
});
