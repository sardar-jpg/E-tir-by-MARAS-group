import { describe, it, expect } from "vitest";
import { getGpsFreshness, GPS_DEFAULT_UPDATE_INTERVAL_MS } from "./gpsFreshness";

const NOW = new Date("2026-07-08T12:00:00.000Z").getTime();

describe("GPS_DEFAULT_UPDATE_INTERVAL_MS", () => {
  it("is exactly 15 minutes — Smart Tracking, not every-second live tracking", () => {
    expect(GPS_DEFAULT_UPDATE_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(GPS_DEFAULT_UPDATE_INTERVAL_MS).toBe(900000);
  });
});

describe("getGpsFreshness", () => {
  it("returns 'none' when there is no last-updated value", () => {
    expect(getGpsFreshness(undefined, NOW)).toEqual({ status: "none", minutesAgo: null });
    expect(getGpsFreshness(null, NOW)).toEqual({ status: "none", minutesAgo: null });
    expect(getGpsFreshness("", NOW)).toEqual({ status: "none", minutesAgo: null });
  });

  it("returns 'none' for an unparsable timestamp rather than crashing", () => {
    expect(getGpsFreshness("not-a-date", NOW)).toEqual({ status: "none", minutesAgo: null });
  });

  it("returns 'fresh' with minutes elapsed for a recent update", () => {
    const fiveMinAgo = new Date(NOW - 5 * 60000).toISOString();
    expect(getGpsFreshness(fiveMinAgo, NOW)).toEqual({ status: "fresh", minutesAgo: 5 });
  });

  it("treats exactly the default threshold (30 min) as still fresh", () => {
    const thirtyMinAgo = new Date(NOW - 30 * 60000).toISOString();
    expect(getGpsFreshness(thirtyMinAgo, NOW)).toEqual({ status: "fresh", minutesAgo: 30 });
  });

  it("returns 'stale' once past the default threshold", () => {
    const fortyFiveMinAgo = new Date(NOW - 45 * 60000).toISOString();
    expect(getGpsFreshness(fortyFiveMinAgo, NOW)).toEqual({ status: "stale", minutesAgo: 45 });
  });

  it("honors a custom stale threshold", () => {
    const tenMinAgo = new Date(NOW - 10 * 60000).toISOString();
    expect(getGpsFreshness(tenMinAgo, NOW, 5)).toEqual({ status: "stale", minutesAgo: 10 });
  });

  it("never returns negative minutes for a timestamp slightly in the future (clock drift)", () => {
    const future = new Date(NOW + 5000).toISOString();
    expect(getGpsFreshness(future, NOW)).toEqual({ status: "fresh", minutesAgo: 0 });
  });
});
