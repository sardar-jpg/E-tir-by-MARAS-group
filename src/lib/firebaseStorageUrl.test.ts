import { describe, it, expect } from "vitest";
import { buildFirebaseDownloadUrl } from "./firebaseStorageUrl";

describe("buildFirebaseDownloadUrl", () => {
  it("builds the standard Firebase Storage download URL shape", () => {
    const url = buildFirebaseDownloadUrl("etir-by-maras-group.firebasestorage.app", "uploads/admin/1/file.pdf", "abc-123");
    expect(url).toBe(
      "https://firebasestorage.googleapis.com/v0/b/etir-by-maras-group.firebasestorage.app/o/uploads%2Fadmin%2F1%2Ffile.pdf?alt=media&token=abc-123"
    );
  });

  it("percent-encodes slashes in the object path (Firebase Storage's flat object namespace)", () => {
    const url = buildFirebaseDownloadUrl("bucket", "a/b/c.png", "tok");
    expect(url).toContain("/o/a%2Fb%2Fc.png");
    expect(url).not.toContain("/o/a/b/c.png");
  });

  it("percent-encodes spaces and special characters in filenames", () => {
    const url = buildFirebaseDownloadUrl("bucket", "uploads/My File (1).pdf", "tok");
    expect(url).toContain(encodeURIComponent("uploads/My File (1).pdf"));
  });

  it("never expires — the URL carries no expiry parameter, only a static token", () => {
    const url = buildFirebaseDownloadUrl("bucket", "a.png", "tok");
    expect(url).not.toContain("Expires");
    expect(url).not.toContain("X-Goog-Expires");
    expect(url).toContain("alt=media");
    expect(url).toContain("token=tok");
  });

  it("produces different URLs for different tokens on the same path", () => {
    const url1 = buildFirebaseDownloadUrl("bucket", "a.png", "token-1");
    const url2 = buildFirebaseDownloadUrl("bucket", "a.png", "token-2");
    expect(url1).not.toBe(url2);
  });

  it("reflects the given bucket name in the path", () => {
    const url = buildFirebaseDownloadUrl("my-other-bucket", "a.png", "tok");
    expect(url).toContain("/b/my-other-bucket/o/");
  });
});
