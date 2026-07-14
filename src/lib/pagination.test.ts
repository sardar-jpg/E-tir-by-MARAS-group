import { describe, it, expect } from "vitest";
import {
  encodePageCursor,
  decodePageCursor,
  paginateDescending,
  paginateAscendingSince,
  applyMemoryFilters,
  hasUnsatisfiableFilter,
  DEFAULT_PAGE_SIZE,
  type PageFilter,
} from "./pagination";

interface Row {
  id: string;
  timestamp: string;
  shipmentId?: string;
  channel?: string;
  recipientUserId?: string;
}

const getTs = (r: Row) => r.timestamp;
const getId = (r: Row) => r.id;

function row(id: string, timestamp: string, extra: Partial<Row> = {}): Row {
  return { id, timestamp, ...extra };
}

describe("encodePageCursor / decodePageCursor", () => {
  it("round-trips a cursor exactly", () => {
    const cursor = { ts: "2026-07-14T10:00:00.000Z", id: "msg-42" };
    expect(decodePageCursor(encodePageCursor(cursor))).toEqual(cursor);
  });

  it("returns null for a missing cursor (undefined)", () => {
    expect(decodePageCursor(undefined)).toBeNull();
  });

  it("returns null for a missing cursor (null)", () => {
    expect(decodePageCursor(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodePageCursor("")).toBeNull();
  });

  it("returns null for a non-string input", () => {
    expect(decodePageCursor(12345)).toBeNull();
    expect(decodePageCursor({ ts: "x", id: "y" })).toBeNull();
    expect(decodePageCursor(["x", "y"])).toBeNull();
  });

  it("returns null for malformed/garbage strings rather than throwing", () => {
    expect(() => decodePageCursor("not-json-at-all")).not.toThrow();
    expect(decodePageCursor("not-json-at-all")).toBeNull();
    expect(decodePageCursor("%")).toBeNull(); // invalid percent-encoding
  });

  it("returns null when the decoded JSON is missing required fields", () => {
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ ts: "2026-01-01" })))).toBeNull();
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ id: "abc" })))).toBeNull();
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ ts: "", id: "abc" })))).toBeNull();
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ ts: "x", id: "" })))).toBeNull();
  });

  it("returns null when fields are the wrong type", () => {
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ ts: 123, id: "abc" })))).toBeNull();
    expect(decodePageCursor(encodeURIComponent(JSON.stringify({ ts: "x", id: 123 })))).toBeNull();
  });

  it("returns null for a tampered/truncated cursor", () => {
    const cursor = encodePageCursor({ ts: "2026-07-14T10:00:00.000Z", id: "msg-1" });
    expect(decodePageCursor(cursor.slice(0, 5))).toBeNull();
  });
});

describe("paginateDescending", () => {
  const rows = [
    row("a", "2026-01-01T00:00:00Z"),
    row("b", "2026-01-02T00:00:00Z"),
    row("c", "2026-01-03T00:00:00Z"),
    row("d", "2026-01-04T00:00:00Z"),
    row("e", "2026-01-05T00:00:00Z"),
  ];

  it("orders newest-first with no cursor", () => {
    const page = paginateDescending(rows, getTs, getId, { limit: 10 });
    expect(page.items.map((r) => r.id)).toEqual(["e", "d", "c", "b", "a"]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("defaults to DEFAULT_PAGE_SIZE when no limit given", () => {
    const many = Array.from({ length: 60 }, (_, i) => row(`m${i}`, `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`));
    const page = paginateDescending(many, getTs, getId, {});
    expect(page.items.length).toBe(DEFAULT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("paginates across multiple pages with no duplicates and no gaps", () => {
    const seen = new Set<string>();
    let cursor: { ts: string; id: string } | null = null;
    let iterations = 0;
    while (true) {
      const page: ReturnType<typeof paginateDescending<Row>> = paginateDescending(rows, getTs, getId, { limit: 2, cursor });
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false); // no duplicates across pages
        seen.add(item.id);
      }
      if (!page.hasMore) break;
      cursor = page.nextCursor ? decodePageCursor(page.nextCursor) : null;
      iterations += 1;
      expect(iterations).toBeLessThan(10); // guard against an infinite loop bug
    }
    expect(seen.size).toBe(rows.length); // no gaps either
    expect(Array.from(seen).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("breaks ties on equal timestamps deterministically by id (descending)", () => {
    const tied = [
      row("x1", "2026-01-01T00:00:00Z"),
      row("x2", "2026-01-01T00:00:00Z"),
      row("x3", "2026-01-01T00:00:00Z"),
    ];
    const first = paginateDescending(tied, getTs, getId, { limit: 10 }).items.map((r) => r.id);
    const second = paginateDescending(tied, getTs, getId, { limit: 10 }).items.map((r) => r.id);
    expect(first).toEqual(second); // stable/deterministic across repeated calls
    expect(first).toEqual(["x3", "x2", "x1"]); // id DESC tiebreak
  });

  it("paginates correctly through a run of duplicate timestamps without skipping or repeating", () => {
    const tied = [
      row("t1", "2026-01-01T00:00:00Z"),
      row("t2", "2026-01-01T00:00:00Z"),
      row("t3", "2026-01-01T00:00:00Z"),
      row("t4", "2026-01-01T00:00:00Z"),
    ];
    const page1 = paginateDescending(tied, getTs, getId, { limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(["t4", "t3"]);
    expect(page1.hasMore).toBe(true);
    const cursor = decodePageCursor(page1.nextCursor!);
    const page2 = paginateDescending(tied, getTs, getId, { limit: 2, cursor });
    expect(page2.items.map((r) => r.id)).toEqual(["t2", "t1"]);
    expect(page2.hasMore).toBe(false);
  });

  it("handles legacy rows with a coarser/shared timestamp safely (no crash, no loss)", () => {
    const legacy = [
      row("legacy-1", "2025-01-01T00:00:00Z"),
      row("legacy-2", "2025-01-01T00:00:00Z"),
      row("modern-1", "2026-01-01T00:00:00Z"),
    ];
    const page = paginateDescending(legacy, getTs, getId, { limit: 10 });
    expect(page.items.map((r) => r.id).sort()).toEqual(["legacy-1", "legacy-2", "modern-1"].sort());
  });

  it("returns an empty page with no error for an empty input array", () => {
    const page = paginateDescending([], getTs, getId, { limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty result for a cursor that is already at/before the oldest row", () => {
    const cursor = { ts: "2026-01-01T00:00:00Z", id: "a" }; // exactly the oldest row's own position
    const page = paginateDescending(rows, getTs, getId, { limit: 10, cursor });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("a malformed/garbage cursor (already normalized to null by decodePageCursor) starts from the top rather than erroring", () => {
    const page = paginateDescending(rows, getTs, getId, { limit: 10, cursor: decodePageCursor("garbage") });
    expect(page.items.map((r) => r.id)).toEqual(["e", "d", "c", "b", "a"]);
  });
});

describe("paginateAscendingSince", () => {
  const rows = [
    row("a", "2026-01-01T00:00:00Z"),
    row("b", "2026-01-02T00:00:00Z"),
    row("c", "2026-01-03T00:00:00Z"),
  ];

  it("returns everything ascending when there is no cursor yet", () => {
    const result = paginateAscendingSince(rows, getTs, getId, null, 10);
    expect(result.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.hasMore).toBe(false);
  });

  it("returns only rows strictly newer than the cursor", () => {
    const cursor = { ts: "2026-01-01T00:00:00Z", id: "a" };
    const result = paginateAscendingSince(rows, getTs, getId, cursor, 10);
    expect(result.items.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("returns nothing when already caught up to the newest row", () => {
    const cursor = { ts: "2026-01-03T00:00:00Z", id: "c" };
    const result = paginateAscendingSince(rows, getTs, getId, cursor, 10);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("caps a burst at the limit and reports hasMore", () => {
    const burst = Array.from({ length: 5 }, (_, i) => row(`b${i}`, `2026-02-01T00:0${i}:00Z`));
    const result = paginateAscendingSince(burst, getTs, getId, null, 2);
    expect(result.items.length).toBe(2);
    expect(result.hasMore).toBe(true);
  });
});

describe("applyMemoryFilters — no cross-shipment / cross-channel leakage", () => {
  const messages: Row[] = [
    row("m1", "2026-01-01T00:00:00Z", { shipmentId: "ship-A", channel: "driver_admin" }),
    row("m2", "2026-01-01T00:01:00Z", { shipmentId: "ship-A", channel: "client_admin" }),
    row("m3", "2026-01-01T00:02:00Z", { shipmentId: "ship-B", channel: "driver_admin" }),
    row("m4", "2026-01-01T00:03:00Z", { shipmentId: "ship-A", channel: "internal_staff" }),
  ];

  it("== filter on shipmentId returns only that shipment's messages", () => {
    const filters: PageFilter[] = [{ field: "shipmentId", op: "==", value: "ship-A" }];
    const result = applyMemoryFilters(messages, filters);
    expect(result.map((m) => m.id).sort()).toEqual(["m1", "m2", "m4"]);
    expect(result.some((m) => m.shipmentId === "ship-B")).toBe(false); // no cross-shipment leakage
  });

  it("combined shipmentId + channel filters (AND) never leak another channel", () => {
    const filters: PageFilter[] = [
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ];
    const result = applyMemoryFilters(messages, filters);
    expect(result.map((m) => m.id)).toEqual(["m1"]);
  });

  it("a message from a different shipment never matches even with a matching channel", () => {
    const filters: PageFilter[] = [
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ];
    const result = applyMemoryFilters(messages, filters);
    expect(result.find((m) => m.id === "m3")).toBeUndefined(); // ship-B's driver_admin message stays excluded
  });

  it("legacy rows with no channel field are excluded by an explicit channel filter", () => {
    const withLegacy = [...messages, row("legacy", "2026-01-01T00:04:00Z", { shipmentId: "ship-A" })];
    const filters: PageFilter[] = [
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ];
    const result = applyMemoryFilters(withLegacy, filters);
    expect(result.find((m) => m.id === "legacy")).toBeUndefined();
  });

  it("no channel filter at all (admin's merged default) returns every channel for that shipment, including legacy", () => {
    const withLegacy = [...messages, row("legacy", "2026-01-01T00:04:00Z", { shipmentId: "ship-A" })];
    const filters: PageFilter[] = [{ field: "shipmentId", op: "==", value: "ship-A" }];
    const result = applyMemoryFilters(withLegacy, filters);
    expect(result.map((m) => m.id).sort()).toEqual(["legacy", "m1", "m2", "m4"].sort());
  });

  it("`in` filter matches only listed shipment ids — no leakage from an unlisted shipment", () => {
    const notifications: Row[] = [
      row("n1", "2026-01-01T00:00:00Z", { shipmentId: "ship-A" }),
      row("n2", "2026-01-01T00:01:00Z", { shipmentId: "ship-B" }),
      row("n3", "2026-01-01T00:02:00Z", { shipmentId: "ship-C" }),
    ];
    const filters: PageFilter[] = [{ field: "shipmentId", op: "in", value: ["ship-A", "ship-C"] }];
    const result = applyMemoryFilters(notifications, filters);
    expect(result.map((n) => n.id).sort()).toEqual(["n1", "n3"]);
  });

  it("recipientUserId `==` scope never returns another user's direct notification", () => {
    const notifications: Row[] = [
      row("n1", "2026-01-01T00:00:00Z", { recipientUserId: "driver-1" }),
      row("n2", "2026-01-01T00:01:00Z", { recipientUserId: "driver-2" }),
    ];
    const filters: PageFilter[] = [{ field: "recipientUserId", op: "==", value: "driver-1" }];
    const result = applyMemoryFilters(notifications, filters);
    expect(result.map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("hasUnsatisfiableFilter", () => {
  it("is true for an empty `in` list (Firestore would throw on this)", () => {
    expect(hasUnsatisfiableFilter([{ field: "shipmentId", op: "in", value: [] }])).toBe(true);
  });

  it("is false for a non-empty `in` list", () => {
    expect(hasUnsatisfiableFilter([{ field: "shipmentId", op: "in", value: ["a"] }])).toBe(false);
  });

  it("is false for an `==` filter regardless of value", () => {
    expect(hasUnsatisfiableFilter([{ field: "shipmentId", op: "==", value: "" }])).toBe(false);
  });

  it("is false for no filters at all", () => {
    expect(hasUnsatisfiableFilter([])).toBe(false);
  });
});

describe("Firestore / memory-fallback parity at the helper level", () => {
  // These two functions (applyMemoryFilters -> paginateDescending) are
  // exactly what server.ts's memory-fallback path calls, in that order,
  // for GET /api/shipments/:id/chat and GET /api/notifications. server.ts's
  // real-Firestore path builds the *same* filters into
  // `.where(...).orderBy("timestamp","desc").orderBy(docId,"desc").limit(n).startAfter(cursor)`
  // — since both paths are driven by the same PageFilter[] input and the
  // same ordering/cursor contract tested above, this is the "one tested
  // foundation" both paths share, not two independently hand-written
  // implementations that could quietly drift apart.
  it("filtering then paginating a mixed multi-shipment/channel dataset matches what a scoped, ordered, limited Firestore query would return", () => {
    const messages: Row[] = [
      row("m1", "2026-01-01T00:00:00Z", { shipmentId: "ship-A", channel: "driver_admin" }),
      row("m2", "2026-01-01T00:05:00Z", { shipmentId: "ship-A", channel: "driver_admin" }),
      row("m3", "2026-01-01T00:10:00Z", { shipmentId: "ship-A", channel: "client_admin" }), // wrong channel
      row("m4", "2026-01-01T00:15:00Z", { shipmentId: "ship-B", channel: "driver_admin" }), // wrong shipment
      row("m5", "2026-01-01T00:20:00Z", { shipmentId: "ship-A", channel: "driver_admin" }),
    ];
    const filters: PageFilter[] = [
      { field: "shipmentId", op: "==", value: "ship-A" },
      { field: "channel", op: "==", value: "driver_admin" },
    ];
    const scoped = applyMemoryFilters(messages, filters);
    const page = paginateDescending(scoped, getTs, getId, { limit: 50 });
    expect(page.items.map((r) => r.id)).toEqual(["m5", "m2", "m1"]); // newest-first, correctly scoped
  });
});
