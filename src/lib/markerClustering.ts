/**
 * markerClustering.ts
 *
 * Operations Center redesign — pure, deterministic clustering for map markers.
 *
 * When many shipments sit near the same point (e.g. several trucks parked at
 * the same border crossing, or a dense fleet on one corridor segment), their
 * markers overlap into an unreadable blob. This groups nearby markers into a
 * single cluster bubble (with a count) so the operator sees "5 here" instead
 * of five stacked pins, and can zoom in to separate them.
 *
 * It is intentionally free of React / Google Maps / DOM so the grouping rule
 * can be unit tested in isolation and reused by both the Vector Radar and the
 * Google Map. Input points are already-projected screen/grid coordinates; the
 * caller decides the pixel radius (typically larger when zoomed out).
 */

export interface ClusterablePoint {
  x: number;
  y: number;
}

export interface MarkerCluster<T extends ClusterablePoint> {
  /** Centroid X of the grouped items (average of member x). */
  x: number;
  /** Centroid Y of the grouped items (average of member y). */
  y: number;
  /** The original points grouped into this cluster (never empty). */
  items: T[];
  /** Convenience: items.length. 1 means a lone, un-clustered marker. */
  count: number;
}

/**
 * Greedy single-pass clustering: walk the points in order, and drop each one
 * into the first existing cluster whose current centroid is within `radius`,
 * otherwise start a new cluster. Deterministic for a given input order, and
 * O(n·k) where k is the number of clusters — more than adequate for the tens
 * of markers a tracking map ever shows at once.
 *
 * A non-positive radius disables grouping (every point becomes its own
 * cluster), which is the correct behaviour when fully zoomed in.
 */
export function clusterMarkers<T extends ClusterablePoint>(
  points: readonly T[],
  radius: number
): MarkerCluster<T>[] {
  const clusters: MarkerCluster<T>[] = [];
  if (radius <= 0) {
    return points.map(p => ({ x: p.x, y: p.y, items: [p], count: 1 }));
  }
  const r2 = radius * radius;

  for (const p of points) {
    let placed = false;
    for (const c of clusters) {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy <= r2) {
        c.items.push(p);
        c.count = c.items.length;
        // Recompute the centroid so it tracks the members' true centre.
        c.x = c.items.reduce((s, it) => s + it.x, 0) / c.count;
        c.y = c.items.reduce((s, it) => s + it.y, 0) / c.count;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ x: p.x, y: p.y, items: [p], count: 1 });
    }
  }

  return clusters;
}
