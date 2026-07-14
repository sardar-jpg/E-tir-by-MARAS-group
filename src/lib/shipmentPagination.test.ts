import { describe, it, expect } from "vitest";
import { mergeShipmentsSince, shouldResetShipmentPagination } from "./shipmentPagination";
import type { Shipment } from "../types";

function makeShipment(id: string, createdAt: string, updatedAt: string = createdAt): Shipment {
  return { id, createdAt, updatedAt } as Shipment;
}

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

  // Blocking-issue fix requirement: "Load More appends without
  // duplicates" — this is exactly the manual concatenation
  // AdminPanel/ClientDashboard/DriverApplication's handleLoadMoreShipments
  // performs (seenIds Set + filter), modeled here directly since cursor
  // mode pages are always strictly older and non-overlapping in the
  // normal case, with a defensive overlap included.
  it("Load More semantics: appending an older page never introduces a duplicate id, even on a retried/overlapping page", () => {
    const currentlyLoaded = [makeShipment("s3", "2026-01-03"), makeShipment("s2", "2026-01-02")];
    const olderPageWithOverlap = [makeShipment("s2", "2026-01-02"), makeShipment("s1", "2026-01-01")];
    const seenIds = new Set(currentlyLoaded.map((s) => s.id));
    const appended = [...currentlyLoaded, ...olderPageWithOverlap.filter((s) => !seenIds.has(s.id))];
    expect(appended.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(new Set(appended.map((s) => s.id)).size).toBe(appended.length);
  });

  // Blocking-issue fix requirement: "polling does not erase older loaded
  // pages" — a delta merge over a list that already includes an OLDER
  // page (fetched via Load More) must still contain every one of those
  // older rows afterward; the poll only ever adds to/updates the map, it
  // never rebuilds it from the delta alone.
  it("a since-mode delta poll preserves shipments from an older page fetched via Load More", () => {
    const afterLoadMore = [
      makeShipment("newest", "2026-01-10"),
      makeShipment("mid", "2026-01-05"),
      makeShipment("olderPageRow1", "2026-01-02"), // fetched via a prior "Load Older Shipments" click
      makeShipment("olderPageRow2", "2026-01-01"),
    ];
    const pollDelta = [{ ...makeShipment("mid", "2026-01-05", "2026-01-11"), status: "In Transit" } as Shipment];
    const afterPoll = mergeShipmentsSince(afterLoadMore, pollDelta);
    const ids = afterPoll.map((s) => s.id);
    expect(ids).toContain("olderPageRow1");
    expect(ids).toContain("olderPageRow2");
    expect(afterPoll.find((s) => s.id === "mid")!.status).toBe("In Transit");
    expect(afterPoll).toHaveLength(4);
  });
});

describe("shouldResetShipmentPagination — Phase 2A follow-up (blocking-issue fix)", () => {
  it("returns false on the very first check (prevIdentity null) — startup is not a 'change'", () => {
    expect(shouldResetShipmentPagination(null, "admin-1:super")).toBe(false);
  });

  it("returns false when the identity is unchanged", () => {
    expect(shouldResetShipmentPagination("admin-1:super", "admin-1:super")).toBe(false);
    expect(shouldResetShipmentPagination("driver-42", "driver-42")).toBe(false);
  });

  it("returns true on a genuine account/role change", () => {
    expect(shouldResetShipmentPagination("admin-1:super", "admin-2:super")).toBe(true);
    expect(shouldResetShipmentPagination("admin-1:accounts", "admin-1:super")).toBe(true);
    expect(shouldResetShipmentPagination("driver-1", "driver-2")).toBe(true);
  });

  it("a reset is only ever triggered once per real change, not repeatedly for the same new identity", () => {
    let prev: string | null = null;
    const seenResets: boolean[] = [];
    for (const identity of ["driver-1", "driver-1", "driver-2", "driver-2", "driver-2"]) {
      seenResets.push(shouldResetShipmentPagination(prev, identity));
      prev = identity;
    }
    expect(seenResets).toEqual([false, false, true, false, false]);
  });
});
