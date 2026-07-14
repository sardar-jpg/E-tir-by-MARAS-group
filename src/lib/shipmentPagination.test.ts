import { describe, it, expect } from "vitest";
import { fetchAllShipmentPages, mergeShipmentsSince } from "./shipmentPagination";
import type { Shipment } from "../types";

function makeShipment(id: string, createdAt: string, updatedAt: string = createdAt): Shipment {
  return { id, createdAt, updatedAt } as Shipment;
}

describe("fetchAllShipmentPages — Phase 2A (Firestore scalability audit, shipments/orders)", () => {
  it("returns a single page's items unchanged when hasMore is false", async () => {
    const items = [makeShipment("s1", "2026-01-03"), makeShipment("s2", "2026-01-02")];
    const result = await fetchAllShipmentPages(async () => ({ items, nextCursor: null, hasMore: false }));
    expect(result).toEqual(items);
  });

  it("pages through to exhaustion, concatenating in fetched order (newest-first, preserved)", async () => {
    const pages = [
      { items: [makeShipment("s1", "2026-01-03"), makeShipment("s2", "2026-01-02")], nextCursor: "cursor-1", hasMore: true },
      { items: [makeShipment("s3", "2026-01-01")], nextCursor: null, hasMore: false },
    ];
    let calls = 0;
    const result = await fetchAllShipmentPages(async (cursor) => {
      expect(cursor).toBe(calls === 0 ? null : "cursor-1");
      return pages[calls++];
    });
    expect(result.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(calls).toBe(2);
  });

  it("passes the previous page's nextCursor to the next call, unchanged", async () => {
    const seenCursors: (string | null)[] = [];
    await fetchAllShipmentPages(async (cursor) => {
      seenCursors.push(cursor);
      if (cursor === null) return { items: [makeShipment("s1", "2026-01-01")], nextCursor: "abc", hasMore: true };
      if (cursor === "abc") return { items: [makeShipment("s2", "2026-01-02")], nextCursor: "xyz", hasMore: true };
      return { items: [], nextCursor: null, hasMore: false };
    });
    expect(seenCursors).toEqual([null, "abc", "xyz"]);
  });

  it("stops if hasMore is true but nextCursor is missing — never loops on a broken page", async () => {
    let calls = 0;
    const result = await fetchAllShipmentPages(async () => {
      calls++;
      return { items: [makeShipment("s1", "2026-01-01")], nextCursor: null, hasMore: true };
    });
    expect(calls).toBe(1);
    expect(result).toHaveLength(1);
  });

  it("returns an empty array for an empty first page", async () => {
    const result = await fetchAllShipmentPages(async () => ({ items: [], nextCursor: null, hasMore: false }));
    expect(result).toEqual([]);
  });

  it("has a hard cap on the number of page fetches — never loops unboundedly", async () => {
    let calls = 0;
    const result = await fetchAllShipmentPages(async () => {
      calls++;
      return { items: [makeShipment(`s${calls}`, `2026-01-${String(calls).padStart(2, "0")}`)], nextCursor: `c${calls}`, hasMore: true };
    });
    // MAX_PAGES = 50 — should stop there, not loop forever.
    expect(calls).toBe(50);
    expect(result).toHaveLength(50);
  });
});

describe("mergeShipmentsSince — Phase 2A (Firestore scalability audit, shipments/orders)", () => {
  it("appends a genuinely new shipment id", () => {
    const existing = [makeShipment("s1", "2026-01-02")];
    const incoming = [makeShipment("s2", "2026-01-03")];
    const merged = mergeShipmentsSince(existing, incoming);
    expect(merged.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("replaces an existing shipment in place (upsert by id) rather than duplicating it", () => {
    const existing = [makeShipment("s1", "2026-01-01", "2026-01-01")];
    const changed = { ...makeShipment("s1", "2026-01-01", "2026-01-05"), status: "In Transit" } as Shipment;
    const merged = mergeShipmentsSince(existing, [changed]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(changed);
  });

  it("returns the SAME array reference when incoming is empty — no unnecessary re-render trigger", () => {
    const existing = [makeShipment("s1", "2026-01-01")];
    const merged = mergeShipmentsSince(existing, []);
    expect(merged).toBe(existing);
  });

  it("re-sorts the merged result by createdAt descending, regardless of merge order", () => {
    const existing = [makeShipment("old", "2026-01-01"), makeShipment("mid", "2026-01-05")];
    const incoming = [makeShipment("newest", "2026-01-10")];
    const merged = mergeShipmentsSince(existing, incoming);
    expect(merged.map((s) => s.id)).toEqual(["newest", "mid", "old"]);
  });

  it("never drops or duplicates an id across a merge", () => {
    const existing = [makeShipment("s1", "2026-01-01"), makeShipment("s2", "2026-01-02")];
    const incoming = [makeShipment("s2", "2026-01-02", "2026-01-09"), makeShipment("s3", "2026-01-03")];
    const merged = mergeShipmentsSince(existing, incoming);
    const ids = merged.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("preserves both rows when two shipments share the exact same createdAt (a legitimate tie, not a duplicate)", () => {
    const existing = [makeShipment("a", "2026-01-01T00:00:00.000Z"), makeShipment("b", "2026-01-01T00:00:00.000Z")];
    const merged = mergeShipmentsSince(existing, []);
    expect(merged).toBe(existing); // empty incoming short-circuits, both still present
    const mergedWithChange = mergeShipmentsSince(existing, [makeShipment("c", "2026-01-01T00:00:00.000Z")]);
    expect(mergedWithChange.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });
});
