import { describe, it, expect } from "vitest";
import {
  planImageOptimization,
  scaleToMaxLongEdge,
  isLikelyHeic,
  CHAT_IMAGE_MAX_LONG_EDGE_PX,
  CHAT_IMAGE_JPEG_QUALITY,
  CHAT_IMAGE_PASSTHROUGH_BYTES,
} from "./chatImageOptimize";

/**
 * feature/admin-chat-mobile-ux-pass — the document-safe optimization
 * DECISION table. The canvas/bitmap work in optimizeChatImage is browser
 * API glue with a hard fall-back-to-original contract; every threshold
 * decision lives here, pure and testable.
 */

const base = { mimeType: "image/jpeg", fileName: "photo.jpg", sizeBytes: 4 * 1024 * 1024, width: 4032, height: 3024 };

describe("planImageOptimization — thresholds", () => {
  it("a large phone JPEG downscales to the 1600px long edge at quality 0.82", () => {
    const plan = planImageOptimization(base);
    expect(plan).toEqual({
      action: "reencode",
      targetWidth: 1600,
      targetHeight: 1200,
      outputType: "image/jpeg",
      quality: CHAT_IMAGE_JPEG_QUALITY,
      reason: "oversized_dimensions",
    });
  });

  it("a small image passes through unchanged — never enlarged, never re-encoded", () => {
    const plan = planImageOptimization({ ...base, sizeBytes: 120 * 1024, width: 800, height: 600 });
    expect(plan).toEqual({ action: "passthrough", reason: "already_small" });
  });

  it("a byte-heavy but pixel-small JPEG re-encodes at its OWN dimensions (no upscaling)", () => {
    const plan = planImageOptimization({ ...base, sizeBytes: 900 * 1024, width: 1400, height: 1000 });
    expect(plan).toEqual({
      action: "reencode",
      targetWidth: 1400,
      targetHeight: 1000,
      outputType: "image/jpeg",
      quality: CHAT_IMAGE_JPEG_QUALITY,
      reason: "oversized_bytes",
    });
  });

  it("PNG is NEVER converted to JPEG — oversized PNG downscales as PNG, small PNG passes through", () => {
    const big = planImageOptimization({ ...base, mimeType: "image/png", fileName: "doc.png", width: 3200, height: 1800 });
    expect(big.action).toBe("reencode");
    if (big.action === "reencode") {
      expect(big.outputType).toBe("image/png");
      expect(big.quality).toBeUndefined();
    }
    // A byte-heavy but pixel-small PNG (e.g. a dense document screenshot)
    // stays exactly as it is — transparency and crisp text preserved.
    const smallDims = planImageOptimization({ ...base, mimeType: "image/png", fileName: "doc.png", sizeBytes: 2 * 1024 * 1024, width: 1200, height: 900 });
    expect(smallDims).toEqual({ action: "passthrough", reason: "already_small" });
  });

  it("WebP re-encodes to JPEG under the same rules as JPEG", () => {
    const plan = planImageOptimization({ ...base, mimeType: "image/webp", fileName: "photo.webp" });
    expect(plan.action).toBe("reencode");
    if (plan.action === "reencode") expect(plan.outputType).toBe("image/jpeg");
  });

  it("files at or below the 300KB passthrough threshold with in-range dimensions are untouched", () => {
    const plan = planImageOptimization({ ...base, sizeBytes: CHAT_IMAGE_PASSTHROUGH_BYTES, width: 1600, height: 1600 });
    expect(plan).toEqual({ action: "passthrough", reason: "already_small" });
  });

  it("HEIC/HEIF is reported UNSUPPORTED — by MIME type or by extension — never processed or silently uploaded", () => {
    expect(planImageOptimization({ ...base, mimeType: "image/heic", fileName: "IMG_0001.heic" })).toEqual({ action: "unsupported_heic" });
    // iOS sometimes hands over an empty type with only the extension.
    expect(planImageOptimization({ ...base, mimeType: "", fileName: "IMG_0001.HEIF" })).toEqual({ action: "unsupported_heic" });
  });

  it("non-image / non-optimizable types pass through — the server allowlist stays the real gate", () => {
    expect(planImageOptimization({ ...base, mimeType: "image/gif", fileName: "a.gif" })).toEqual({ action: "passthrough", reason: "not_optimizable_type" });
    expect(planImageOptimization({ ...base, mimeType: "application/pdf", fileName: "a.pdf" })).toEqual({ action: "passthrough", reason: "not_optimizable_type" });
  });
});

describe("scaleToMaxLongEdge", () => {
  it("scales the long edge down to exactly 1600 preserving aspect ratio", () => {
    expect(scaleToMaxLongEdge(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(scaleToMaxLongEdge(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it("never enlarges", () => {
    expect(scaleToMaxLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaleToMaxLongEdge(CHAT_IMAGE_MAX_LONG_EDGE_PX, 900)).toEqual({ width: CHAT_IMAGE_MAX_LONG_EDGE_PX, height: 900 });
  });
});

describe("isLikelyHeic", () => {
  it("detects MIME variants and extensions, and nothing else", () => {
    expect(isLikelyHeic({ type: "image/heic", name: "x.jpg" })).toBe(true);
    expect(isLikelyHeic({ type: "image/heif-sequence", name: "x" })).toBe(true);
    expect(isLikelyHeic({ type: "", name: "photo.HEIC" })).toBe(true);
    expect(isLikelyHeic({ type: "image/jpeg", name: "photo.jpg" })).toBe(false);
    expect(isLikelyHeic({ type: "image/png", name: "heic-notes.png" })).toBe(false);
  });
});
