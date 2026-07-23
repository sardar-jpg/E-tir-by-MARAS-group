import { describe, it, expect } from "vitest";
import { clusterMarkers } from "./markerClustering";

describe("clusterMarkers", () => {
  it("returns one cluster per point when radius is non-positive (fully zoomed in)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 100, y: 100 }];
    const zero = clusterMarkers(pts, 0);
    expect(zero).toHaveLength(3);
    expect(zero.every(c => c.count === 1)).toBe(true);
    expect(clusterMarkers(pts, -5)).toHaveLength(3);
  });

  it("groups points within the radius into a single cluster with a count", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 1, y: 1 }];
    const clusters = clusterMarkers(pts, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].items).toHaveLength(3);
  });

  it("keeps far-apart points in separate clusters", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
    const clusters = clusterMarkers(pts, 20);
    expect(clusters).toHaveLength(3);
    expect(clusters.every(c => c.count === 1)).toBe(true);
  });

  it("places a cluster centroid at the average of its members", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 6 }];
    const [c] = clusterMarkers(pts, 100);
    expect(c.count).toBe(3);
    expect(c.x).toBeCloseTo((0 + 10 + 5) / 3, 6);
    expect(c.y).toBeCloseTo((0 + 0 + 6) / 3, 6);
  });

  it("respects the radius boundary (just outside stays separate)", () => {
    // distance between the two points is exactly 10
    const pts = [{ x: 0, y: 0 }, { x: 6, y: 8 }];
    expect(clusterMarkers(pts, 10)).toHaveLength(1); // <= radius -> merged
    expect(clusterMarkers(pts, 9)).toHaveLength(2); // > radius -> separate
  });

  it("preserves the original items (with their extra fields) inside clusters", () => {
    const pts = [
      { x: 0, y: 0, id: "a" },
      { x: 2, y: 2, id: "b" },
      { x: 500, y: 500, id: "c" },
    ];
    const clusters = clusterMarkers(pts, 20);
    const ids = clusters.flatMap(c => c.items.map(i => i.id)).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for no points", () => {
    expect(clusterMarkers([], 50)).toEqual([]);
  });

  it("is deterministic for a fixed input order", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }, { x: 40, y: 0 }];
    const a = clusterMarkers(pts, 6);
    const b = clusterMarkers(pts, 6);
    expect(a).toEqual(b);
  });
});
