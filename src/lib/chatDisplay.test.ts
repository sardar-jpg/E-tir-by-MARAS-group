import { describe, it, expect } from "vitest";
import {
  localDateKey,
  shouldShowDateSeparator,
  formatDateSeparatorLabel,
  isNearBottom,
  NEAR_BOTTOM_THRESHOLD_PX,
  computeAutoGrowHeightPx,
} from "./chatDisplay";

describe("localDateKey", () => {
  it("produces the same key for two timestamps on the same local calendar day", () => {
    expect(localDateKey("2026-07-13T01:00:00.000Z")).toBe(localDateKey("2026-07-13T20:00:00.000Z"));
  });
});

describe("shouldShowDateSeparator", () => {
  it("always shows a separator for the first message in a thread", () => {
    expect(shouldShowDateSeparator("2026-07-13T10:00:00.000Z", undefined)).toBe(true);
  });

  it("does not show a separator for two messages on the same calendar day", () => {
    expect(shouldShowDateSeparator("2026-07-13T20:00:00.000Z", "2026-07-13T09:00:00.000Z")).toBe(false);
  });

  it("shows a separator when the calendar day changes, even a minute apart", () => {
    // Constructed via local-time components (not UTC ISO strings) so this
    // is deterministic regardless of the test runner's timezone: 11:59pm
    // and 12:01am the same night are different LOCAL calendar days.
    const localJuly13Late = new Date(2026, 6, 13, 23, 59).toISOString();
    const localJuly14Early = new Date(2026, 6, 14, 0, 1).toISOString();
    expect(shouldShowDateSeparator(localJuly14Early, localJuly13Late)).toBe(true);
  });

  it("shows a separator across a longer gap", () => {
    expect(shouldShowDateSeparator("2026-07-20T10:00:00.000Z", "2026-07-13T10:00:00.000Z")).toBe(true);
  });
});

describe("formatDateSeparatorLabel", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("labels a message from today as 'Today' (en)", () => {
    expect(formatDateSeparatorLabel("2026-07-13T08:00:00.000Z", "en", now)).toBe("Today");
  });

  it("labels a message from today as 'Bugün' (tr)", () => {
    expect(formatDateSeparatorLabel("2026-07-13T08:00:00.000Z", "tr", now)).toBe("Bugün");
  });

  it("labels a message from today as 'اليوم' (ar)", () => {
    expect(formatDateSeparatorLabel("2026-07-13T08:00:00.000Z", "ar", now)).toBe("اليوم");
  });

  it("labels a message from yesterday as 'Yesterday' (en)", () => {
    expect(formatDateSeparatorLabel("2026-07-12T08:00:00.000Z", "en", now)).toBe("Yesterday");
  });

  it("labels a message from yesterday as 'Dün' (tr)", () => {
    expect(formatDateSeparatorLabel("2026-07-12T08:00:00.000Z", "tr", now)).toBe("Dün");
  });

  it("labels a message from yesterday as 'أمس' (ar)", () => {
    expect(formatDateSeparatorLabel("2026-07-12T08:00:00.000Z", "ar", now)).toBe("أمس");
  });

  it("falls back to a locale-formatted date for anything older", () => {
    const label = formatDateSeparatorLabel("2026-06-01T08:00:00.000Z", "en", now);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).toContain("2026");
  });
});

describe("isNearBottom", () => {
  it("is near the bottom at 0px away", () => {
    expect(isNearBottom(0)).toBe(true);
  });

  it("is near the bottom at exactly the threshold", () => {
    expect(isNearBottom(NEAR_BOTTOM_THRESHOLD_PX)).toBe(true);
  });

  it("is not near the bottom just past the threshold", () => {
    expect(isNearBottom(NEAR_BOTTOM_THRESHOLD_PX + 1)).toBe(false);
  });

  it("is not near the bottom when scrolled far up reading history", () => {
    expect(isNearBottom(2000)).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(isNearBottom(50, 200)).toBe(true);
    expect(isNearBottom(250, 200)).toBe(false);
  });
});

describe("computeAutoGrowHeightPx", () => {
  it("uses the content height when within min/max bounds", () => {
    expect(computeAutoGrowHeightPx(80, 40, 200)).toBe(80);
  });

  it("clamps up to the minimum for short/empty content", () => {
    expect(computeAutoGrowHeightPx(10, 40, 200)).toBe(40);
  });

  it("clamps down to the maximum for very long content", () => {
    expect(computeAutoGrowHeightPx(500, 40, 200)).toBe(200);
  });
});
