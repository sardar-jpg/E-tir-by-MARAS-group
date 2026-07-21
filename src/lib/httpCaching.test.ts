import { describe, it, expect } from "vitest";
import { cacheControlForAsset, isImmutableCacheControl, shouldCompress } from "./httpCaching";

describe("cacheControlForAsset", () => {
  it("hashed build assets under /assets/ are immutable for a year", () => {
    expect(cacheControlForAsset("/assets/index-dI7Y0FE0.js")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(cacheControlForAsset("/assets/AdminPanel-Dg9w-gcF.js")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(cacheControlForAsset("/assets/index-BDA2WGwZ.css")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(isImmutableCacheControl(cacheControlForAsset("/assets/x-abc123.js"))).toBe(true);
  });

  it("the HTML entry document is never immutably cached", () => {
    expect(cacheControlForAsset("/")).toBe("no-cache");
    expect(cacheControlForAsset("/index.html")).toBe("no-cache");
    expect(cacheControlForAsset("/some/nested/index.html")).toBe("no-cache");
    expect(isImmutableCacheControl(cacheControlForAsset("/index.html"))).toBe(false);
    expect(isImmutableCacheControl(cacheControlForAsset("/"))).toBe(false);
  });

  it("other root files revalidate (favicon/manifest/etc.)", () => {
    expect(cacheControlForAsset("/favicon.ico")).toBe("public, max-age=0, must-revalidate");
    expect(cacheControlForAsset("/manifest.webmanifest")).toBe("public, max-age=0, must-revalidate");
    expect(isImmutableCacheControl(cacheControlForAsset("/favicon.ico"))).toBe(false);
  });

  it("ignores query strings when classifying", () => {
    expect(cacheControlForAsset("/assets/index-abc.js?v=2")).toBe(
      "public, max-age=31536000, immutable"
    );
  });
});

describe("shouldCompress", () => {
  it("compresses text-like and structured types", () => {
    for (const ct of [
      "text/html; charset=utf-8",
      "text/css",
      "application/json",
      "application/javascript",
      "text/javascript",
      "image/svg+xml",
      "application/manifest+json",
      "application/xml",
    ]) {
      expect(shouldCompress(ct)).toBe(true);
    }
  });

  it("skips already-compressed binary types", () => {
    for (const ct of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "audio/mpeg",
      "application/zip",
      "application/pdf",
      "font/woff2",
      "application/octet-stream",
    ]) {
      expect(shouldCompress(ct)).toBe(false);
    }
  });

  it("returns false for missing/unknown content types", () => {
    expect(shouldCompress(undefined)).toBe(false);
    expect(shouldCompress("")).toBe(false);
    expect(shouldCompress("application/x-unknown-thing")).toBe(false);
  });
});
