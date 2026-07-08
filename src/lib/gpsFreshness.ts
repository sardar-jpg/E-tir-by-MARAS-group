/**
 * gpsFreshness.ts
 *
 * Shared "how fresh is this location" logic for Smart Tracking views
 * (admin corridor radar, driver's own tracker, customer shipment map).
 * eTIR GPS updates periodically (not every second), so every view that
 * shows a coordinate must also show when it was last received and flag
 * it as stale rather than implying a continuous live feed.
 */

/**
 * eTIR uses Smart Tracking, not live every-second tracking: the driver
 * app transmits its GPS fix on this interval by default (manual updates
 * are still sent immediately when the driver takes an in-app action).
 * 15 minutes protects driver battery and app performance while still
 * keeping "last known location" reasonably current.
 */
export const GPS_DEFAULT_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

export type GpsFreshnessStatus = "none" | "fresh" | "stale";

export interface GpsFreshness {
  status: GpsFreshnessStatus;
  minutesAgo: number | null;
}

const DEFAULT_STALE_THRESHOLD_MINUTES = 30;

export function getGpsFreshness(
  lastUpdated: string | undefined | null,
  nowMs: number,
  staleThresholdMinutes: number = DEFAULT_STALE_THRESHOLD_MINUTES
): GpsFreshness {
  if (!lastUpdated) return { status: "none", minutesAgo: null };

  const then = new Date(lastUpdated).getTime();
  if (Number.isNaN(then)) return { status: "none", minutesAgo: null };

  const minutesAgo = Math.max(0, Math.round((nowMs - then) / 60000));
  return {
    status: minutesAgo > staleThresholdMinutes ? "stale" : "fresh",
    minutesAgo,
  };
}
