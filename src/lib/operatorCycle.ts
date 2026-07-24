/**
 * operatorCycle.ts
 *
 * Operator Room — pure auto-cycle sequencing.
 *
 * The Operator Room (large-TV monitoring mode) can slowly cycle the focus
 * through the currently tracked shipments. This module owns the sequencing
 * rules so they are unit-testable and free of React/timers:
 *  - only REAL, placeable shipments are ever cycled (the caller supplies the
 *    placeability predicate backed by resolveTrackingPosition — shipments
 *    with no honest position are skipped, never fabricated onto the map);
 *  - the index advances one step per tick and wraps around;
 *  - an empty target list yields -1 (nothing to focus).
 */

/** One focus dwell per shipment on the operations TV. */
export const OPERATOR_CYCLE_INTERVAL_MS = 12000;

/**
 * Advance the cycle index by one, wrapping at `total`. Returns -1 when there
 * is nothing to cycle; entering a non-empty cycle from "nothing focused"
 * (current < 0) starts at 0.
 */
export function advanceCycle(current: number, total: number): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return 0;
  return (current + 1) % total;
}

/**
 * The shipments eligible for the auto-cycle: exactly the ones the map can
 * honestly place (real driver fix or known city anchor). Order is preserved
 * from the input list so the TV cycles in the same order the panel lists.
 */
export function selectCycleTargets<T>(
  shipments: readonly T[],
  isPlaceable: (s: T) => boolean
): T[] {
  return shipments.filter(isPlaceable);
}
