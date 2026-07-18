import { describe, it, expect } from "vitest";
import {
  clampLightboxZoom,
  nextDoubleTapZoom,
  LIGHTBOX_MIN_ZOOM,
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_DOUBLE_TAP_ZOOM,
} from "./imageLightboxState";

describe("clampLightboxZoom", () => {
  it("clamps below 1x and above 6x", () => {
    expect(clampLightboxZoom(0.2)).toBe(LIGHTBOX_MIN_ZOOM);
    expect(clampLightboxZoom(3)).toBe(3);
    expect(clampLightboxZoom(99)).toBe(LIGHTBOX_MAX_ZOOM);
  });

  it("never lets a non-finite value reach a CSS transform", () => {
    expect(clampLightboxZoom(Number.NaN)).toBe(LIGHTBOX_MIN_ZOOM);
    expect(clampLightboxZoom(Infinity)).toBe(LIGHTBOX_MIN_ZOOM);
  });
});

describe("nextDoubleTapZoom", () => {
  it("toggles fit → reading zoom → fit", () => {
    expect(nextDoubleTapZoom(1)).toBe(LIGHTBOX_DOUBLE_TAP_ZOOM);
    expect(nextDoubleTapZoom(LIGHTBOX_DOUBLE_TAP_ZOOM)).toBe(LIGHTBOX_MIN_ZOOM);
    expect(nextDoubleTapZoom(4)).toBe(LIGHTBOX_MIN_ZOOM);
  });
});
